/**
 * Types definition for typesafe/jev model running on Cloudflare Workers AI
 */

export type JevQuestionType = 'noul' | 'choice' | 'score';

export interface JevNoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: {
    true?: string;
    false?: string;
  };
}

export interface JevChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export interface JevScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

export interface JevNoulAnswer {
  type: 'noul';
  noul: number; // 0.0 - 1.0 calibrated probability of true
}

export interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevScoreAnswer {
  type: 'score';
  score: number;
  confidence: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
}

export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export interface JevModelResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface JevEvaluationInput {
  state: unknown;
  questions: Record<string, JevQuestion>;
}
