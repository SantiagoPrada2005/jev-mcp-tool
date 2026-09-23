export interface Env {
  AI: {
    run: (model: string, input: Record<string, unknown>) => Promise<any>;
  };
  MCP_SESSION: DurableObjectNamespace;
  AUTH_TOKEN?: string;
  HEARTBEAT_INTERVAL_MS?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
}
