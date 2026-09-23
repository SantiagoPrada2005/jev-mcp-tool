import { Env } from './config/env';
import { McpSessionDO } from './durable-object/session.do';

export { McpSessionDO };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // 2. Security: Perimeter Bearer Token verification
    if (env.AUTH_TOKEN) {
      const authHeader = request.headers.get('Authorization');
      const expected = `Bearer ${env.AUTH_TOKEN}`;
      if (!authHeader || authHeader !== expected) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized: Invalid or missing Bearer token' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // 3. Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          service: 'jev-mcp-server',
          status: 'healthy',
          runtime: 'Cloudflare Workers (Stateful SSE + Durable Objects)',
          model: 'typesafe/jev (System 1 Deterministic Evaluator)',
          endpoints: {
            sse: '/sse',
            message: '/message?sessionId=:sessionId',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 4. SSE Stream endpoint: GET /sse
    if (request.method === 'GET' && url.pathname === '/sse') {
      const sessionId = url.searchParams.get('sessionId') || crypto.randomUUID();
      const doId = env.MCP_SESSION.idFromName(sessionId);
      const stub = env.MCP_SESSION.get(doId);

      // Forward request to Durable Object
      const doUrl = new URL(request.url);
      doUrl.searchParams.set('sessionId', sessionId);
      return stub.fetch(new Request(doUrl.toString(), request));
    }

    // 5. JSON-RPC Message endpoint: POST /message
    if (request.method === 'POST' && url.pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        return new Response(
          JSON.stringify({ error: 'Bad Request: "sessionId" query parameter is required for /message' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const doId = env.MCP_SESSION.idFromName(sessionId);
      const stub = env.MCP_SESSION.get(doId);
      return stub.fetch(request);
    }

    return new Response(
      JSON.stringify({ error: 'Not Found', path: url.pathname }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  },
};
