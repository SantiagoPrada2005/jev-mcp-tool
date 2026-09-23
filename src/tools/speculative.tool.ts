import { z } from 'zod';
import { JevEvaluationService } from '../services/jev.service';
import { JevQuestion } from '../core/types';

export const speculativeToolSchema = {
  name: 'speculative_eval',
  description:
    'DESPLIEGUE ESPECULATIVO UNIFICADO (FAN-OUT). Invoca esta herramienta cuando requieras evaluar múltiples preguntas analíticas heterogéneas (noul/booleano, choice/clasificación categórica, o score/rúbrica) sobre un mismo estado en un ÚNICO viaje de ida y vuelta de red. Maximiza la eficiencia y minimiza la latencia agregada del agente.',
  parameters: z.object({
    state: z
      .any()
      .describe('El estado o bloque de información a evaluar (texto o estructura JSON).'),
    questions: z
      .record(
        z.object({
          type: z
            .enum(['noul', 'choice', 'score'])
            .describe('Tipo de evaluación requerida.'),
          instructions: z
            .string()
            .min(5)
            .describe('Instrucción atómica y objetiva para el evaluador.'),
          criteria: z
            .union([
              z.record(z.string()), // For noul { true: '...', false: '...' } or choice { optA: '...', optB: '...' }
              z.array(z.string()),  // For score ['lvl 0', 'lvl 1', 'lvl 2']
            ])
            .optional()
            .describe('Definición de criterios observables.'),
        })
      )
      .refine((q) => Object.keys(q).length > 0, 'Debe incluir al menos una pregunta.')
      .describe('Mapa de preguntas tipadas asociadas a una clave de respuesta.'),
  }),
};

export async function handleSpeculativeEval(
  jevService: JevEvaluationService,
  args: {
    state: unknown;
    questions: Record<string, JevQuestion>;
  }
) {
  const result = await jevService.evaluate({
    state: args.state,
    questions: args.questions,
  });

  return {
    model: result.model,
    answers: result.answers,
    usage: result.usage,
  };
}
