import { z } from 'zod';
import { JevEvaluationService } from '../services/jev.service';
import { JevNoulAnswer, JevQuestion } from '../core/types';

export const prunerToolSchema = {
  name: 'context_pruner',
  description:
    'DEPURACIÓN Y PODA CONTEXTUAL PARA RAG. Invoca esta herramienta para cribar fragmentos recuperados de bases de datos vectoriales antes de inyectarlos en tu memoria o razonamiento. Evalúa concurrentemente en una sola pasada de red la pertinencia fáctica de cada fragmento frente a la consulta del usuario, descartando ruido y previniendo el sesgo Lost in the Middle.',
  parameters: z.object({
    query: z
      .string()
      .min(1, 'query no puede estar vacío')
      .describe('Pregunta o necesidad de información del usuario.'),
    chunks: z
      .array(
        z.object({
          id: z.string().describe('Identificador único del chunk documental.'),
          content: z.string().describe('Texto del fragmento recuperado.'),
        })
      )
      .min(1, 'Debe proveer al menos un fragmento para evaluar.')
      .max(15, 'Máximo 15 fragmentos por evaluación para garantizar latencia sub-200ms.')
      .describe('Lista de fragmentos a evaluar.'),
    relevance_threshold: z
      .number()
      .min(0.1)
      .max(0.9)
      .optional()
      .default(0.6)
      .describe('Umbral probabilístico mínimo para conservar un chunk (default 0.6).'),
  }),
};

export async function handlePruner(
  jevService: JevEvaluationService,
  args: {
    query: string;
    chunks: Array<{ id: string; content: string }>;
    relevance_threshold?: number;
  }
) {
  const threshold = args.relevance_threshold ?? 0.6;
  const chunkMap: Record<string, string> = {};
  const questions: Record<string, JevQuestion> = {};

  args.chunks.forEach((chunk, index) => {
    const key = `c_${index}`;
    chunkMap[key] = chunk.content;
    questions[key] = {
      type: 'noul',
      instructions: `Does chunk "${key}" provide factually relevant, accurate information directly addressing the user query?`,
      criteria: {
        true: 'Directly answers or provides necessary factual context for the query.',
        false: 'Irrelevant, tangential, repetitive or noisy information.',
      },
    };
  });

  const result = await jevService.evaluate({
    state: {
      user_query: args.query,
      retrieved_chunks: chunkMap,
    },
    questions,
  });

  const evaluated = args.chunks.map((chunk, index) => {
    const key = `c_${index}`;
    const ans = result.answers[key] as JevNoulAnswer;
    const probability = ans?.noul ?? 0;
    return {
      id: chunk.id,
      retained: probability >= threshold,
      relevance_probability: Number(probability.toFixed(3)),
    };
  });

  const retained = evaluated.filter((c) => c.retained);

  return {
    total_evaluated: evaluated.length,
    retained_count: retained.length,
    pruned_count: evaluated.length - retained.length,
    chunks: evaluated,
  };
}
