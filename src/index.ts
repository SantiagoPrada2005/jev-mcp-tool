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
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version, mcp-session-id, Last-Event-ID',
          'Access-Control-Expose-Headers': 'mcp-session-id',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const isSseGet = request.method === 'GET' && (
      url.pathname === '/sse' ||
      url.pathname === '/mcp' ||
      (url.pathname === '/' && request.headers.get('Accept')?.includes('text/event-stream') === true)
    );

    const isMcpPost = request.method === 'POST' && (
      url.pathname === '/' ||
      url.pathname === '/mcp' ||
      url.pathname === '/sse' ||
      url.pathname === '/message'
    );

    const isMcpDelete = request.method === 'DELETE';

    // 2. Security: Perimeter token verification on MCP endpoints
    if (env.AUTH_TOKEN && (isSseGet || isMcpPost || isMcpDelete)) {
      const authHeader = request.headers.get('Authorization');
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader?.trim();
      const queryToken = url.searchParams.get('token') || url.searchParams.get('auth');
      const token = bearerToken || queryToken;

      if (!token || token !== env.AUTH_TOKEN) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized: Invalid or missing authentication token' }),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }
        );
      }
    }

    // 3. Health check (GET /health or GET / when NOT requesting an SSE stream)
    if (request.method === 'GET' && (url.pathname === '/health' || (url.pathname === '/' && !isSseGet))) {
      return new Response(
        JSON.stringify({
          service: 'jev-mcp-server',
          status: 'healthy',
          runtime: 'Cloudflare Workers (Streamable HTTP + Stateful SSE + Durable Objects)',
          model: 'typesafe/jev (System 1 Deterministic Evaluator)',
          endpoints: {
            mcp: '/mcp',
            sse: '/sse',
            root: '/',
            message: '/message?sessionId=:sessionId',
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // 4. SSE Stream endpoint: GET /sse, GET /mcp, or GET / with Accept: text/event-stream
    if (isSseGet) {
      const sessionId = request.headers.get('mcp-session-id') || url.searchParams.get('sessionId') || crypto.randomUUID();
      const doId = env.MCP_SESSION.idFromName(sessionId);
      const stub = env.MCP_SESSION.get(doId);

      const doUrl = new URL(request.url);
      doUrl.searchParams.set('sessionId', sessionId);
      const res = await stub.fetch(new Request(doUrl.toString(), request));

      const resHeaders = new Headers(res.headers);
      if (!resHeaders.has('mcp-session-id')) {
        resHeaders.set('mcp-session-id', sessionId);
      }
      resHeaders.set('Access-Control-Allow-Origin', '*');
      resHeaders.set('Access-Control-Expose-Headers', 'mcp-session-id');

      return new Response(res.body, {
        status: res.status,
        headers: resHeaders,
      });
    }

    // 5. Streamable HTTP JSON-RPC endpoint: POST /, /mcp, /sse, /message
    if (isMcpPost) {
      const sessionId = request.headers.get('mcp-session-id') || url.searchParams.get('sessionId') || crypto.randomUUID();
      const doId = env.MCP_SESSION.idFromName(sessionId);
      const stub = env.MCP_SESSION.get(doId);

      const doUrl = new URL(request.url);
      doUrl.searchParams.set('sessionId', sessionId);
      const res = await stub.fetch(new Request(doUrl.toString(), request));

      const resHeaders = new Headers(res.headers);
      if (!resHeaders.has('mcp-session-id')) {
        resHeaders.set('mcp-session-id', sessionId);
      }
      resHeaders.set('Access-Control-Allow-Origin', '*');
      resHeaders.set('Access-Control-Expose-Headers', 'mcp-session-id');

      return new Response(res.body, {
        status: res.status,
        headers: resHeaders,
      });
    }

    // 6. DELETE session
    if (isMcpDelete) {
      const sessionId = request.headers.get('mcp-session-id') || url.searchParams.get('sessionId');
      if (sessionId) {
        const doId = env.MCP_SESSION.idFromName(sessionId);
        const stub = env.MCP_SESSION.get(doId);
        return stub.fetch(request);
      }
      return new Response(null, {
        status: 204,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    return new Response(
      JSON.stringify({ error: 'Not Found', path: url.pathname }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  },
};
