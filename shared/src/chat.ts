import { z } from 'zod';
import type { ErrorCode } from './api.js';
import type { SourceKind } from './sources.js';

export const MAX_QUESTION_LENGTH = 2000;

export const chatRequestSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, 'Ask a question')
    .max(MAX_QUESTION_LENGTH, `Question must be at most ${MAX_QUESTION_LENGTH} characters`),
  /**
   * Restrict retrieval to these sources. When omitted or empty, the answer is
   * grounded in every source the asking user owns.
   */
  sourceIds: z.array(z.string().uuid('Invalid source id')).max(100).optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/**
 * One source that supported the answer, surfaced to the client as a reference.
 *
 * Citations are per source, not per chunk: several passages from the same
 * document collapse into a single reference so the list reads like a
 * bibliography. `index` is the number the model was given for that source, so
 * an inline `[2]` in the answer and the reference numbered 2 always agree.
 */
export interface ChatCitation {
  /** 1-based marker the answer cites inline as `[index]`. */
  index: number;
  sourceId: string;
  kind: SourceKind;
  title: string;
  /** Website and YouTube sources only, so the reference can link out. */
  url: string | null;
  /** Plain-text excerpts of the passages used, best match first. */
  snippets: string[];
  /** How many retrieved passages came from this source. */
  passageCount: number;
  /** Cosine similarity in [0, 1] of the best passage; higher is more relevant. */
  score: number;
}

export interface ChatResponse {
  answer: string;
  citations: ChatCitation[];
}

/**
 * One server-sent event from `POST /chat/stream`, serialised as JSON in the
 * `data:` field. Retrieval finishes before generation starts, so `citations`
 * always arrives first, then zero or more `token`s, then exactly one terminal
 * `done` or `error`.
 */
export type ChatStreamEvent =
  | { type: 'citations'; citations: ChatCitation[] }
  | { type: 'token'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string; code: ErrorCode };
