import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_NOTEBOOK_EMOJI,
  type CreateNotebookInput,
  type Notebook,
  type NotebookSourceCounts,
  type UpdateNotebookInput,
} from '@personallm/shared';
import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';
import { deleteVectorsForSources } from '../rag/vectorStore.js';

/**
 * Notebooks are the isolation boundary. Every source belongs to exactly one,
 * and `assertOwned` is the single gate every source and chat route passes
 * through — so "can this user read this notebook?" is answered in one place
 * rather than re-derived per endpoint.
 */

interface NotebookRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  emoji: string;
  created_at: string;
  updated_at: string;
  /** Aggregated by the list/read queries below, not stored. */
  ready_count?: number;
  processing_count?: number;
  failed_count?: number;
}

const COUNT_COLUMNS = `
  (SELECT COUNT(*) FROM sources s WHERE s.notebook_id = n.id AND s.status = 'ready')      AS ready_count,
  (SELECT COUNT(*) FROM sources s WHERE s.notebook_id = n.id AND s.status = 'processing') AS processing_count,
  (SELECT COUNT(*) FROM sources s WHERE s.notebook_id = n.id AND s.status = 'failed')     AS failed_count
`;

const selectAll = db.prepare<[string]>(
  `SELECT n.*, ${COUNT_COLUMNS} FROM notebooks n WHERE n.user_id = ? ORDER BY n.updated_at DESC`,
);
const selectOne = db.prepare<[string]>(
  `SELECT n.*, ${COUNT_COLUMNS} FROM notebooks n WHERE n.id = ?`,
);
const insertNotebook = db.prepare(
  `INSERT INTO notebooks (id, user_id, title, description, emoji, created_at, updated_at)
   VALUES (@id, @user_id, @title, @description, @emoji, @created_at, @updated_at)`,
);
const deleteById = db.prepare<[string]>('DELETE FROM notebooks WHERE id = ?');
const touch = db.prepare<[string, string]>('UPDATE notebooks SET updated_at = ? WHERE id = ?');
const selectFilePaths = db.prepare<[string]>(
  'SELECT id, file_path FROM sources WHERE notebook_id = ?',
);

function toNotebook(row: NotebookRow): Notebook {
  const counts: NotebookSourceCounts = {
    ready: row.ready_count ?? 0,
    processing: row.processing_count ?? 0,
    failed: row.failed_count ?? 0,
  };

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    emoji: row.emoji,
    sourceCount: counts.ready + counts.processing + counts.failed,
    counts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listNotebooks(userId: string): Notebook[] {
  return (selectAll.all(userId) as NotebookRow[]).map(toNotebook);
}

/**
 * Loads a notebook, rejecting anything the user does not own.
 *
 * Another user's notebook reports as missing rather than forbidden, so ids
 * cannot be probed — the same rule the source routes follow. Every route that
 * touches notebook-scoped data calls this first.
 */
export function assertOwned(notebookId: string, userId: string): Notebook {
  const row = selectOne.get(notebookId) as NotebookRow | undefined;
  if (!row || row.user_id !== userId) {
    throw ApiError.notFound('Notebook not found');
  }
  return toNotebook(row);
}

export function createNotebook(userId: string, input: CreateNotebookInput): Notebook {
  const now = new Date().toISOString();
  const row: NotebookRow = {
    id: randomUUID(),
    user_id: userId,
    title: input.title,
    description: input.description || null,
    emoji: input.emoji || DEFAULT_NOTEBOOK_EMOJI,
    created_at: now,
    updated_at: now,
  };

  insertNotebook.run(row);
  logger.info('Notebook created', { notebookId: row.id, userId });
  return toNotebook(row);
}

export function updateNotebook(
  notebookId: string,
  userId: string,
  input: UpdateNotebookInput,
): Notebook {
  assertOwned(notebookId, userId);

  // Built from the keys actually present, so omitting a field leaves it alone
  // rather than nulling it.
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (input.title !== undefined) {
    assignments.push('title = ?');
    values.push(input.title);
  }
  if (input.description !== undefined) {
    assignments.push('description = ?');
    values.push(input.description || null);
  }
  if (input.emoji !== undefined) {
    assignments.push('emoji = ?');
    values.push(input.emoji);
  }

  assignments.push('updated_at = ?');
  values.push(new Date().toISOString(), notebookId);

  db.prepare(`UPDATE notebooks SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
  return assertOwned(notebookId, userId);
}

/**
 * Deletes a notebook and everything filed under it: the source rows cascade in
 * SQLite, but the uploaded files and the Qdrant vectors are outside the
 * database and have to be cleaned up explicitly, so they are collected before
 * the row goes.
 */
export function deleteNotebook(notebookId: string, userId: string): void {
  assertOwned(notebookId, userId);

  const sources = selectFilePaths.all(notebookId) as Array<{ id: string; file_path: string | null }>;

  deleteById.run(notebookId); // Sources cascade via the foreign key.

  for (const source of sources) {
    if (source.file_path) fs.rm(source.file_path, { force: true }, () => {});
  }

  // Best-effort, like the single-source delete: the rows are already gone, and
  // orphaned vectors are invisible to search since every query filters on a
  // notebook's live source ids.
  if (env.ragEnabled && sources.length > 0) {
    void deleteVectorsForSources(sources.map((source) => source.id)).catch((error: unknown) => {
      logger.warn('Failed to delete notebook vectors', {
        notebookId,
        error: (error as Error).message,
      });
    });
  }

  logger.info('Notebook deleted', { notebookId, sources: sources.length });
}

/** Bumps `updated_at` so a notebook sorts by last activity, not last rename. */
export function touchNotebook(notebookId: string): void {
  touch.run(new Date().toISOString(), notebookId);
}
