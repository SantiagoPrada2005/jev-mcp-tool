import { Env } from '../config/env';
import { JevEvaluationInput, JevModelResponse, JevAnswer } from '../core/types';

export class JevEvaluationService {
  constructor(private readonly env: Env) {}

  /**
   * Evaluates state against typed questions using Cloudflare Workers AI `typesafe/jev`,
   * with automatic, resilient fallback to OpenRouter when credits are missing or errors occur.
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

      // 2. Fallback: If OpenRouter is configured, delegate to OpenRouter
      if (this.env.OPENROUTER_API_KEY) {
        console.log('[JevService] Triggering OpenRouter fallback...');
        return await this.evaluateWithOpenRouter(input, startTime);
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
   * Fallback engine: Simulates Jev System 1 evaluation using OpenRouter with structured JSON
   */
  private async evaluateWithOpenRouter(
    input: JevEvaluationInput,
    startTime: number
  ): Promise<JevModelResponse> {
    const model = this.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct';

    const systemPrompt = `You are a deterministic, calibrated System 1 evaluation engine emulating TypeSafe Jev.
Your task is to evaluate the provided STATE against the given QUESTIONS.

Rules for each question type:
- "noul": Boolean evaluation. Return calibrated probability (0.0 to 1.0) of being true.
  Format: { "type": "noul", "noul": <float 0.0-1.0> }
- "choice": Discrete classification. Select the best matching key from criteria and return confidence and probability distribution.
  Format: { "type": "choice", "choice": "<matching_key>", "confidence": <float 0.0-1.0>, "probabilities": { "<key>": <float> } }
- "score": Rubric evaluation. Compute numeric score index (e.g. 0.0 to 2.0 based on criteria steps), confidence and probabilities.
  Format: { "type": "score", "score": <float>, "confidence": <float 0.0-1.0>, "probabilities": { "<level_index>": <float> } }

Respond strictly with valid JSON conforming to:
{
  "answers": {
    "<question_key>": { ... }
  }
}
Do NOT include explanations or markdown outside the JSON.`;

    const userPayload = JSON.stringify({
      state: input.state,
      questions: input.questions,
    });

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://jev-mcp-server.workers.dev',
        'X-Title': 'Jev MCP Server Fallback',
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPayload },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouterFallbackError (${response.status}): ${errorText}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('OpenRouterFallbackError: Empty response from model');
    }

    let parsed: { answers: Record<string, JevAnswer> };
    try {
      parsed = JSON.parse(content);
    } catch {
      // Strip markdown code fences if present
      const cleanJson = content.replace(/```json\n?|\n?```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    }

    const elapsedMs = Math.round(performance.now() - startTime);
    console.log(`[JevService] OpenRouter fallback resolved in ${elapsedMs}ms with model ${model}`);

    return {
      model: `openrouter/${model}`,
      answers: parsed.answers,
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? 0,
        output_tokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}
