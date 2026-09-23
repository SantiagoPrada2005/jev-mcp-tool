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

  it('should initiate SSE stream and emit endpoint event in McpSessionDO', async () => {
    const mockEnv = {
      AI: { run: vi.fn() },
      MCP_SESSION: {} as any,
      HEARTBEAT_INTERVAL_MS: '60000',
    };

    const doInstance = new McpSessionDO({} as any, mockEnv);
    const sseRequest = new Request('https://worker.local/sse?sessionId=test-session-123');
    const sseResponse = await doInstance.fetch(sseRequest);

    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get('Content-Type')).toContain('text/event-stream');

    const reader = sseResponse.body?.getReader();
    expect(reader).toBeDefined();

    const firstChunk = await reader!.read();
    const text = new TextDecoder().decode(firstChunk.value);
    expect(text).toContain('event: endpoint');
    expect(text).toContain('/message?sessionId=test-session-123');

    // Test POST message to same DO
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
    expect(postRes.status).toBe(202);

    // Read the next SSE chunk which should contain the JSON-RPC response
    const secondChunk = await reader!.read();
    const secondText = new TextDecoder().decode(secondChunk.value);
    expect(secondText).toContain('event: message');
    expect(secondText).toContain('jev-mcp-server');

    await reader!.cancel();
  });
});
