# Jev MCP Server

> High-throughput, low-latency **Deterministic System 1 Evaluation Server** for LLMs and autonomous AI agents, powered by Cloudflare Workers, Durable Objects, and Typesafe Jev.

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Streamable%20HTTP%20%2B%20SSE-blue)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vitest](https://img.shields.io/badge/Tests-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

---

## 🎯 Architectural Purpose

Large Language Models (LLMs) are **System 2** deliberative engines: they are autorregressive, costly in tokens, sensitive to positional bias (*Lost in the Middle*), and prone to RLHF-induced overconfidence.

**Jev MCP Server** decouples fast, calibrated evaluative judgment from agentic reasoning:
1. **Zero Hallucination:** Deterministic, calibrated probability estimates instead of generative text.
2. **Sub-200ms Roundtrip:** Executes in perimeter edge nodes with minimal network overhead.
3. **High Density, Low Entropy:** Outputs discrete scalar metrics (`directive`, `score`, `confidence`, `retained`) rather than verbose conversational tokens.
4. **Resilient Dual-Inference:** Primary Workers AI execution with seamless fallback to OpenRouter native Jev endpoints (`typesafe/jev-1.13`).

---

## 🛠️ Available MCP Tools

| Tool | Trigger Condition | Primary Benefit |
| :--- | :--- | :--- |
| **`guardrail_gatekeeper`** | Inspecting untrusted inputs (web scrapes, emails, user forms) before storing in memory. | Detects prompt injections, jailbreaks, and instructions override attempts without LLM bias. |
| **`context_pruner`** | Multiple chunks retrieved from RAG / vector databases. | Concurrently evaluates semantic relevance, pruning distractors before they contaminate the context window. |
| **`stop_condition_eval`** | Before marking a complex task complete or handing off artifacts. | Compares work-in-progress against an objective rubric, stopping premature task termination. |
| **`speculative_eval`** | Multi-dimensional classification on a single state in one hop. | Evaluates heterogeneous questions (`noul` boolean, `choice` categorical, `score` rubric) in a single network roundtrip. |

---

## 🌐 MCP Protocol & Transports

`jev-mcp-server` strictly complies with both the modern 2025/2026 MCP specification and legacy transports:

- **Streamable HTTP (Recommended):** Synchronous JSON-RPC via `POST /`, `POST /mcp`, or `POST /sse`. Responds with `200 OK`, `application/json`, and `mcp-session-id` headers. Ideal for **Gemini Spark**, Open WebUI, and stateless integrations.
- **Server-Sent Events (SSE):** `GET /sse` or `GET /mcp` with `Accept: text/event-stream`. Initial `endpoint` announcement and periodic keep-alive comments. Messages posted to `/message?sessionId=...`. Ideal for **Claude Desktop** and **mcp-remote**.

---

## 🚀 Connecting to AI Clients

### 1. Gemini Spark (Connected Apps)
1. Go to **Gemini Web App** → **Settings & help** → **Connected Apps**.
2. Under **Custom apps for Spark**, select **Add a custom app**.
3. Paste your public worker URL with your authentication token:
   ```text
   https://jev-mcp-server.<your-subdomain>.workers.dev?token=<YOUR_AUTH_TOKEN>
   ```
4. Gemini Spark will automatically perform the MCP handshake and load all 4 tools.

### 2. Claude Desktop
Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "jev-evaluator": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://jev-mcp-server.<your-subdomain>.workers.dev/sse",
        "--header",
        "Authorization: Bearer <YOUR_AUTH_TOKEN>"
      ]
    }
  }
}
```

### 3. Cursor / Windsurf / Antigravity (`.mcp.json`)
```json
{
  "mcpServers": {
    "jev-mcp-server": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://jev-mcp-server.<your-subdomain>.workers.dev/sse",
        "--header",
        "Authorization: Bearer <YOUR_AUTH_TOKEN>"
      ]
    }
  }
}
```

---

## 🔒 Security & Perimeter Authentication

When `AUTH_TOKEN` is configured in your Cloudflare environment, all MCP calls (POSTs and SSE streams) require authentication via either:
- **Authorization Header:** `Authorization: Bearer <token>`
- **Query Parameter:** `?token=<token>` or `?auth=<token>`

Public endpoints:
- `GET /health` (JSON health check)
- `OPTIONS *` (CORS preflight with full `mcp-session-id` and `Authorization` support)

---

## 💻 Local Development & Deployment

### Prerequisites
- Node.js 18+
- pnpm (`corepack enable pnpm`)
- Cloudflare account with Workers AI enabled

### Installation
```bash
pnpm install
```

### Run Unit & Integration Tests
```bash
pnpm test
```

### Local Dev Server
```bash
pnpm dev
```

### Deploy to Cloudflare Workers
```bash
npx wrangler deploy
```

### Configure Secrets
```bash
npx wrangler secret put AUTH_TOKEN
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put OPENROUTER_MODEL # optional, defaults to typesafe/jev-1.13
```

---

## 📄 License
MIT
