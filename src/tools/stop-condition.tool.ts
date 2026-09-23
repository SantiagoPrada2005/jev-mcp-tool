import { z } from 'zod';
import { JevEvaluationService } from '../services/jev.service';
import { JevNoulAnswer, JevScoreAnswer } from '../core/types';

export const stopConditionToolSchema = {
  name: 'stop_condition_eval',
  description:
    'EVALUACIÓN DE CRITERIOS DE PARADA Y CONTROL DE CALIDAD. Invoca esta herramienta ANTES de declarar una tarea como finalizada o entregar un artefacto de trabajo. Evalúa objetivamente si el resultado cumple con los requisitos y la rúbrica de aceptación, mitigando la sobreconfianza del LLM e impidiendo la entrega prematura de trabajo incompleto.',
  parameters: z.object({
    artifact: z
      .any()
      .describe('El artefacto producido (código, texto, plan, diff o resultado estructurado).'),
    acceptance_rubric: z
      .array(z.string().min(5))
      .min(2, 'Debe incluir al menos 2 niveles o criterios objetivos de calidad.')
      .max(5, 'Máximo 5 niveles en la rúbrica.')
      .describe('Lista ordenada de criterios de calidad objetiva (de menor a mayor rigor).'),
    pass_threshold: z
      .number()
      .min(0.5)
      .max(4.0)
      .optional()
      .default(1.5)
      .describe('Puntaje escalar mínimo requerido para aprobar la entrega.'),
  }),
};

export async function handleStopCondition(
  jevService: JevEvaluationService,
  args: {
    artifact: unknown;
    acceptance_rubric: string[];
    pass_threshold?: number;
  }
) {
  const threshold = args.pass_threshold ?? 1.5;

  const result = await jevService.evaluate({
    state: {
      work_in_progress: args.artifact,
      rubric_definitions: args.acceptance_rubric,
    },
    questions: {
      is_complete: {
        type: 'noul',
        instructions:
          'Is the artifact substantially complete, addressing all explicit requirements without critical omissions?',
        criteria: {
          true: 'Complete and ready for delivery according to standard engineering criteria.',
          false: 'Incomplete, draft quality, or missing key elements.',
        },
      },
      rubric_score: {
        type: 'score',
        instructions:
          'Score the quality of the work_in_progress strictly against the provided rubric_definitions.',
        criteria: args.acceptance_rubric,
      },
    },
  });

  const completeAns = result.answers.is_complete as JevNoulAnswer;
  const scoreAns = result.answers.rubric_score as JevScoreAnswer;

  const completionProb = completeAns?.noul ?? 0;
  const score = scoreAns?.score ?? 0;
  const confidence = scoreAns?.confidence ?? 0.8;

  const passed = completionProb >= 0.7 && score >= threshold;

  return {
    passed,
    score: Number(score.toFixed(2)),
    completion_probability: Number(completionProb.toFixed(3)),
    confidence: Number(confidence.toFixed(2)),
    directive: passed ? 'PROCEED_FINISH' : 'ITERATE_AND_FIX',
  };
}
