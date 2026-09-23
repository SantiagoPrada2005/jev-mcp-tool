import { describe, it, expect, vi } from 'vitest';
import worker from '../src/index';
import { McpSessionDO } from '../src/durable-object/session.do';

describe('Worker Entrypoint & McpSessionDO Integration', () => {
  it('should return health status on GET /health', async () => {
    const request = new Request('https://worker.local/health');
    const env = { AI: { run: vi.fn() }, MCP_SESSION: {} as any };
    const response = await worker.fetch(request, env, {} as any);

    expect(response.status).toBe(200);
    const data = await response.json() as any;
    expect(data.status).toBe('healthy');
    expect(data.service).toBe('jev-mcp-server');
  });

  it('should handle CORS preflight OPTIONS request', async () => {
    const request = new Request('https://worker.local/sse', { method: 'OPTIONS' });
    const env = { AI: { run: vi.fn() }, MCP_SESSION: {} as any };
    const response = await worker.fetch(request, env, {} as any);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('mcp-session-id');
  });

  it('should reject unauthorized requests when AUTH_TOKEN is set', async () => {
    const request = new Request('https://worker.local/sse', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    const env = {
      AI: { run: vi.fn() },
      MCP_SESSION: {} as any,
      AUTH_TOKEN: 'secret-token',
    };
    const response = await worker.fetch(request, env, {} as any);

    expect(response.status).toBe(401);
  });

  it('should initiate SSE stream and emit endpoint event in McpSessionDO with token preservation', async () => {
    const mockEnv = {
      AI: { run: vi.fn() },
      MCP_SESSION: {} as any,
      HEARTBEAT_INTERVAL_MS: '60000',
    };

    const doInstance = new McpSessionDO({} as any, mockEnv);
    const sseRequest = new Request('https://worker.local/sse?sessionId=test-session-123&token=my-secret-token');
    const sseResponse = await doInstance.fetch(sseRequest);

    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get('Content-Type')).toContain('text/event-stream');

    const reader = sseResponse.body?.getReader();
    expect(reader).toBeDefined();

    const firstChunk = await reader!.read();
    const text = new TextDecoder().decode(firstChunk.value);
    expect(text).toContain('event: endpoint');
    expect(text).toContain('/message?sessionId=test-session-123&token=my-secret-token');

    // Test POST message to same DO - returns 200 directly for Streamable HTTP
    const postReq = new Request('https://worker.local/message?sessionId=test-session-123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    });

    const postRes = await doInstance.fetch(postReq);
    expect(postRes.status).toBe(200);
    const postData = await postRes.json() as any;
    expect(postData.result.serverInfo.name).toBe('jev-mcp-server');

    // Read the next SSE chunk which also contains the JSON-RPC response
    const secondChunk = await reader!.read();
    const secondText = new TextDecoder().decode(secondChunk.value);
    expect(secondText).toContain('event: message');
    expect(secondText).toContain('jev-mcp-server');

    await reader!.cancel();
  });

  it('should handle Streamable HTTP POST directly to root URL with query token', async () => {
    const mockEnv = {
      AI: { run: vi.fn() },
      AUTH_TOKEN: 'secret-token',
      MCP_SESSION: {
        idFromName: vi.fn().mockReturnValue('mock-id'),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockImplementation(async (req: Request) => {
            const doInstance = new McpSessionDO({} as any, mockEnv as any);
            return doInstance.fetch(req);
          }),
        }),
      } as any,
    };

    const postRequest = new Request('https://worker.local/?token=secret-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      }),
    });

    const response = await worker.fetch(postRequest, mockEnv as any, {} as any);
    expect(response.status).toBe(200);
    expect(response.headers.get('mcp-session-id')).toBeDefined();
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const data = await response.json() as any;
    expect(data.jsonrpc).toBe('2.0');
    expect(data.id).toBe(10);
    expect(data.result.serverInfo.name).toBe('jev-mcp-server');
  });

  it('should handle Streamable HTTP POST to /mcp for tools/list', async () => {
    const mockEnv = {
      AI: { run: vi.fn() },
      AUTH_TOKEN: 'secret-token',
      MCP_SESSION: {
        idFromName: vi.fn().mockReturnValue('mock-id'),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockImplementation(async (req: Request) => {
            const doInstance = new McpSessionDO({} as any, mockEnv as any);
            return doInstance.fetch(req);
          }),
        }),
      } as any,
    };

    const postRequest = new Request('https://worker.local/mcp?token=secret-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/list',
        params: {},
      }),
    });

    const response = await worker.fetch(postRequest, mockEnv as any, {} as any);
    expect(response.status).toBe(200);

    const data = await response.json() as any;
    expect(data.jsonrpc).toBe('2.0');
    expect(data.id).toBe(20);
    expect(data.result.tools).toHaveLength(4);
    expect(data.result.tools.map((t: any) => t.name)).toContain('guardrail_gatekeeper');
  });
});
