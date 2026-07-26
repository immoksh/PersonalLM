import { z } from 'zod';
import type { SourceStatus } from './sources.js';

/**
 * A notebook is the unit of isolation: every source belongs to exactly one, and
 * a question asked in one notebook can only ever be answered from that
 * notebook's sources. Nothing crosses the boundary — not retrieval, not the
 * library list.
 */

export const MAX_NOTEBOOK_TITLE_LENGTH = 120;
export const MAX_NOTEBOOK_DESCRIPTION_LENGTH = 400;

/** Offered in the create/rename dialog; any single emoji is accepted though. */
export const NOTEBOOK_EMOJI = [
  '📓',
  '🧠',
  '🔬',
  '📊',
  '🎓',
  '⚗️',
  '🗂️',
  '🚀',
  '💡',
  '🧭',
] as const;

export const DEFAULT_NOTEBOOK_EMOJI = NOTEBOOK_EMOJI[0];

const titleSchema = z
  .string()
  .trim()
  .min(1, 'Give this notebook a name')
  .max(MAX_NOTEBOOK_TITLE_LENGTH, `Name must be at most ${MAX_NOTEBOOK_TITLE_LENGTH} characters`);

const descriptionSchema = z
  .string()
  .trim()
  .max(
    MAX_NOTEBOOK_DESCRIPTION_LENGTH,
    `Description must be at most ${MAX_NOTEBOOK_DESCRIPTION_LENGTH} characters`,
  );

// Length rather than a codepoint check: skin-tone and ZWJ sequences are several
// codepoints, and rejecting them would be worse than accepting a short string.
const emojiSchema = z.string().trim().min(1).max(16, 'Pick a single emoji');

export const createNotebookSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.optional(),
  emoji: emojiSchema.optional(),
});

export const updateNotebookSchema = z
  .object({
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    emoji: emojiSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

export type CreateNotebookInput = z.infer<typeof createNotebookSchema>;
export type UpdateNotebookInput = z.infer<typeof updateNotebookSchema>;

/** Per-status source counts, so a notebook card can show its indexing state. */
export type NotebookSourceCounts = Record<SourceStatus, number>;

export interface Notebook {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  emoji: string;
  /** Total sources in this notebook, and the breakdown by ingestion status. */
  sourceCount: number;
  counts: NotebookSourceCounts;
  createdAt: string;
  updatedAt: string;
}

/** Whether a notebook has anything queryable in it yet. */
export const isNotebookQueryable = (notebook: Notebook): boolean => notebook.counts.ready > 0;
