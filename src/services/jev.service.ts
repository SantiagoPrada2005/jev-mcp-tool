import { Env } from '../config/env';
import { JevEvaluationInput, JevModelResponse } from '../core/types';

export class JevEvaluationService {
  constructor(private readonly env: Env) {}

  /**
   * Evaluates state against typed questions using Cloudflare Workers AI `typesafe/jev`
   */
  async evaluate(input: JevEvaluationInput): Promise<JevModelResponse> {
    const startTime = performance.now();
    try {
      if (!input.state) {
        throw new Error('ValidationError: "state" property is mandatory and cannot be empty.');
      }
      if (!input.questions || Object.keys(input.questions).length === 0) {
        throw new Error('ValidationError: "questions" object must contain at least one question.');
      }

      const response = await this.env.AI.run('typesafe/jev', {
        state: input.state,
        questions: input.questions,
      });

      const elapsedMs = Math.round(performance.now() - startTime);

      if (!response || !response.answers) {
        throw new Error('JevServiceError: Model returned an invalid response structure.');
      }

      return {
        model: response.model || 'typesafe/jev',
        answers: response.answers,
        usage: {
          input_tokens: response.usage?.input_tokens ?? 0,
          output_tokens: response.usage?.output_tokens ?? 0,
        },
      };
    } catch (error: any) {
      const elapsedMs = Math.round(performance.now() - startTime);
      // Zero Data Retention: Log error type and duration without logging input.state
      console.error(JSON.stringify({
        level: 'error',
        service: 'JevEvaluationService',
        duration_ms: elapsedMs,
        message: error.message || 'Unknown evaluation failure',
      }));
      throw error;
    }
  }
}
