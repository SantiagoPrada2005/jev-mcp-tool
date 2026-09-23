import { Env } from '../config/env';
import { JevEvaluationInput, JevModelResponse } from '../core/types';

export class JevEvaluationService {
  constructor(private readonly env: Env) {}

  /**
   * Evaluates state against typed questions using Cloudflare Workers AI `typesafe/jev`,
   * with automatic fallback to OpenRouter's native decisions endpoint (/api/alpha/decisions).
   */
  async evaluate(input: JevEvaluationInput): Promise<JevModelResponse> {
    const startTime = performance.now();

    if (!input.state) {
      throw new Error('ValidationError: "state" property is mandatory and cannot be empty.');
    }
    if (!input.questions || Object.keys(input.questions).length === 0) {
      throw new Error('ValidationError: "questions" object must contain at least one question.');
    }

    // 1. Primary: Try native Cloudflare Workers AI typesafe/jev
    try {
      const response = await this.env.AI.run('typesafe/jev', {
        state: input.state,
        questions: input.questions,
      });

      if (response && response.answers) {
        return {
          model: response.model || 'typesafe/jev',
          answers: response.answers,
          usage: {
            input_tokens: response.usage?.input_tokens ?? 0,
            output_tokens: response.usage?.output_tokens ?? 0,
          },
        };
      }
    } catch (primaryError: any) {
      console.warn(`[JevService] Primary Workers AI evaluation failed: ${primaryError.message}`);

      // 2. Fallback: If OpenRouter is configured, delegate directly to OpenRouter's decisions endpoint
      if (this.env.OPENROUTER_API_KEY) {
        console.log('[JevService] Triggering OpenRouter native Jev endpoint fallback...');
        return await this.evaluateWithOpenRouterDecisions(input, startTime);
      }

      // Re-throw if no fallback key is configured
      const elapsedMs = Math.round(performance.now() - startTime);
      console.error(
        JSON.stringify({
          level: 'error',
          service: 'JevEvaluationService',
          duration_ms: elapsedMs,
          message: primaryError.message,
        })
      );
      throw primaryError;
    }

    throw new Error('JevServiceError: Model returned an invalid response structure.');
  }

  /**
   * Fallback engine: Calls OpenRouter's native decisions endpoint for typesafe/jev-1.13
   */
  private async evaluateWithOpenRouterDecisions(
    input: JevEvaluationInput,
    startTime: number
  ): Promise<JevModelResponse> {
    const model = this.env.OPENROUTER_MODEL || 'typesafe/jev-1.13';

    const response = await fetch('https://openrouter.ai/api/alpha/decisions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://jev-mcp-server.workers.dev',
        'X-Title': 'Jev MCP Server',
      },
      body: JSON.stringify({
        model,
        state: input.state,
        questions: input.questions,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouterDecisionsError (${response.status}): ${errorText}`);
    }

    const data = await response.json() as any;

    if (!data || !data.answers) {
      throw new Error('OpenRouterDecisionsError: Invalid response structure from OpenRouter decisions API');
    }

    const elapsedMs = Math.round(performance.now() - startTime);
    console.log(`[JevService] OpenRouter native Jev fallback resolved in ${elapsedMs}ms with model ${data.model || model}`);

    return {
      model: data.model || `openrouter/${model}`,
      answers: data.answers,
      usage: {
        input_tokens: data.usage?.input_tokens ?? 0,
        output_tokens: data.usage?.output_tokens ?? 0,
      },
    };
  }
}
