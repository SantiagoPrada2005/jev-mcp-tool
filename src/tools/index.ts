import { JevEvaluationService } from '../services/jev.service';
import { handleGuardrail, guardrailToolSchema } from './guardrail.tool';
import { handlePruner, prunerToolSchema } from './pruner.tool';
import { handleStopCondition, stopConditionToolSchema } from './stop-condition.tool';
import { handleSpeculativeEval, speculativeToolSchema } from './speculative.tool';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (jevService: JevEvaluationService, args: any) => Promise<any>;
}

export const TOOLS: McpToolDefinition[] = [
  {
    name: guardrailToolSchema.name,
    description: guardrailToolSchema.description,
    inputSchema: {
      type: 'object',
      properties: {
        untrusted_text: {
          type: 'string',
          description: 'Fragmento de texto de origen externo que requiere validación de seguridad.',
        },
        strict_mode: {
          type: 'boolean',
          description: 'Si es true, clasifica como inseguro ante el menor indicio de ambigüedad.',
          default: false,
        },
      },
      required: ['untrusted_text'],
    },
    handler: (svc, args) => handleGuardrail(svc, args),
  },
  {
    name: prunerToolSchema.name,
    description: prunerToolSchema.description,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Pregunta o necesidad de información del usuario.',
        },
        chunks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Identificador único del chunk documental.' },
              content: { type: 'string', description: 'Texto del fragmento recuperado.' },
            },
            required: ['id', 'content'],
          },
          description: 'Lista de fragmentos a evaluar concurrentemente.',
        },
        relevance_threshold: {
          type: 'number',
          description: 'Umbral probabilístico mínimo para conservar un chunk (default 0.6).',
          default: 0.6,
        },
      },
      required: ['query', 'chunks'],
    },
    handler: (svc, args) => handlePruner(svc, args),
  },
  {
    name: stopConditionToolSchema.name,
    description: stopConditionToolSchema.description,
    inputSchema: {
      type: 'object',
      properties: {
        artifact: {
          description: 'El artefacto producido (código, texto, plan, diff o resultado estructurado).',
        },
        acceptance_rubric: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista ordenada de criterios de calidad objetiva (de menor a mayor rigor).',
        },
        pass_threshold: {
          type: 'number',
          description: 'Puntaje escalar mínimo requerido para aprobar la entrega (default 1.5).',
          default: 1.5,
        },
      },
      required: ['artifact', 'acceptance_rubric'],
    },
    handler: (svc, args) => handleStopCondition(svc, args),
  },
  {
    name: speculativeToolSchema.name,
    description: speculativeToolSchema.description,
    inputSchema: {
      type: 'object',
      properties: {
        state: {
          description: 'El estado o bloque de información a evaluar (texto o estructura JSON).',
        },
        questions: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['noul', 'choice', 'score'],
                description: 'Tipo de evaluación requerida.',
              },
              instructions: {
                type: 'string',
                description: 'Instrucción atómica y objetiva para el evaluador.',
              },
              criteria: {
                description: 'Definición de criterios observables (objeto para noul/choice, array para score).',
              },
            },
            required: ['type', 'instructions'],
          },
          description: 'Mapa de preguntas tipadas asociadas a una clave de respuesta.',
        },
      },
      required: ['state', 'questions'],
    },
    handler: (svc, args) => handleSpeculativeEval(svc, args),
  },
];
