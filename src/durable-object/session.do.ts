import { Env } from '../config/env';
import { JevEvaluationService } from '../services/jev.service';
import { TOOLS } from '../tools';

export class McpSessionDO {
  private ctx: DurableObjectState;
  private env: Env;
  private jevService: JevEvaluationService;
  private sseWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private heartbeatTimer: any = null;
  private sessionId: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.jevService = new JevEvaluationService(env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Extract or initialize sessionId
    if (!this.sessionId) {
      this.sessionId = url.searchParams.get('sessionId') || crypto.randomUUID();
    }

    if (request.method === 'GET' && url.pathname.endsWith('/sse')) {
      return this.handleSseConnect(url);
    }

    if (request.method === 'POST') {
      return this.handlePostMessage(request);
    }

    return new Response('Not Found', { status: 404 });
  }

  private handleSseConnect(url: URL): Response {
    // If there is an existing writer, close it cleanly
    this.cleanupSse();

    const { readable, writable } = new TransformStream();
    this.sseWriter = writable.getWriter();

    const encoder = new TextEncoder();

    // 1. Initial MCP endpoint announcement event
    const endpointEvent = `event: endpoint\ndata: /message?sessionId=${this.sessionId}\n\n`;
    this.sseWriter.write(encoder.encode(endpointEvent)).catch(() => this.cleanupSse());

    // 2. Setup periodic keep-alive heartbeat (every 15s)
    const intervalMs = Number(this.env.HEARTBEAT_INTERVAL_MS) || 15000;
    this.heartbeatTimer = setInterval(() => {
      if (this.sseWriter) {
        this.sseWriter.write(encoder.encode(': keep-alive\n\n')).catch(() => this.cleanupSse());
      }
    }, intervalMs);

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  private async handlePostMessage(request: Request): Promise<Response> {
    try {
      const body = await request.json() as any;

      if (!body || typeof body !== 'object') {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Process message in background and emit to SSE stream
      this.processMessage(body).catch((err) => {
        console.error('Unhandled JSON-RPC processing error:', err);
      });

      return new Response(JSON.stringify({ status: 'accepted', sessionId: this.sessionId }), {
        status: 202,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error: any) {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: error.message } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async processMessage(rpc: any): Promise<void> {
    const id = rpc.id;
    const method = rpc.method;
    const params = rpc.params;

    // Handle notifications (no id)
    if (id === undefined || id === null) {
      if (method === 'notifications/initialized') {
        // Client ack, no response needed
        return;
      }
      return;
    }

    let responseRpc: any;

    try {
      switch (method) {
        case 'initialize': {
          responseRpc = {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: { listChanged: false },
              },
              serverInfo: {
                name: 'jev-mcp-server',
                version: '1.0.0',
              },
            },
          };
          break;
        }

        case 'ping': {
          responseRpc = { jsonrpc: '2.0', id, result: {} };
          break;
        }

        case 'tools/list': {
          responseRpc = {
            jsonrpc: '2.0',
            id,
            result: {
              tools: TOOLS.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            },
          };
          break;
        }

        case 'tools/call': {
          const toolName = params?.name;
          const toolArgs = params?.arguments || {};
          const tool = TOOLS.find((t) => t.name === toolName);

          if (!tool) {
            responseRpc = {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32601,
                message: `Tool not found: "${toolName}"`,
              },
            };
            break;
          }

          try {
            const output = await tool.handler(this.jevService, toolArgs);
            responseRpc = {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(output),
                  },
                ],
                isError: false,
              },
            };
          } catch (toolError: any) {
            responseRpc = {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      error: toolError.message || 'Execution error',
                      code: 'TOOL_EXECUTION_FAILED',
                    }),
                  },
                ],
                isError: true,
              },
            };
          }
          break;
        }

        default: {
          responseRpc = {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not implemented: ${method}`,
            },
          };
        }
      }
    } catch (err: any) {
      responseRpc = {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err.message || 'Internal RPC error',
        },
      };
    }

    await this.sendSseEvent('message', responseRpc);
  }

  private async sendSseEvent(event: string, data: any): Promise<void> {
    if (!this.sseWriter) {
      console.warn(`Cannot send event ${event}: SSE stream is not active for session ${this.sessionId}`);
      return;
    }

    try {
      const encoder = new TextEncoder();
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      await this.sseWriter.write(encoder.encode(payload));
    } catch (error) {
      console.error('Error writing to SSE writer:', error);
      this.cleanupSse();
    }
  }

  private cleanupSse(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.sseWriter) {
      try {
        this.sseWriter.close().catch(() => {});
      } catch {
        // Ignored
      }
      this.sseWriter = null;
    }
  }
}
