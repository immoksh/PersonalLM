import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  parseYouTubeId,
  type CreateTextSourceInput,
  type CreateWebsiteSourceInput,
  type CreateYouTubeSourceInput,
  type FileSourceKind,
  type ListSourcesQuery,
  type Source,
  type SourceDetail,
  type SourceKind,
  type SourceStatus,
} from '@personallm/shared';
import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { ApiError } from '../../utils/ApiError.js';
import { scheduleIngestion } from '../../queue/index.js';
import { assertOwned, touchNotebook } from '../notebooks/notebooks.service.js';
import { deleteSourceVectors } from '../rag/vectorStore.js';

/**
 * The columns a source is created with. Deliberately excludes the ones
 * ingestion fills in later — `baseRow` builds one of these and hands it
 * straight to `insertSource`, and better-sqlite3 rejects an object carrying
 * keys the statement has no placeholder for.
 */
interface SourceRow {
  id: string;
  user_id: string;
  notebook_id: string;
  kind: SourceKind;
  title: string;
  url: string | null;
  video_id: string | null;
  content: string | null;
  preview: string | null;
  file_name: string | null;
  file_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  status: SourceStatus;
  created_at: string;
}

/** A full row as read back, including what ingestion wrote. */
interface SourceDetailRow extends SourceRow {
  extracted_text: string | null;
  page_count: number | null;
  error_message: string | null;
}

/** `file_path` and raw `content` stay server-side; the client gets a preview. */
const toSource = (row: SourceRow): Source => ({
  id: row.id,
  userId: row.user_id,
  notebookId: row.notebook_id,
  kind: row.kind,
  title: row.title,
  url: row.url,
  videoId: row.video_id,
  preview: row.preview,
  fileName: row.file_name,
  fileSize: row.file_size,
  status: row.status,
  createdAt: row.created_at,
});

/**
 * The list shape plus the indexed text a citation's offsets address. Only the
 * viewer asks for this — it is the whole document, so it stays off every list
 * response. The stored rich-text `content` is deliberately not included: the
 * client would have to render it as HTML to be worth sending, and the extracted
 * text is both safe to render and the thing the answer was generated from.
 */
const toSourceDetail = (row: SourceDetailRow): SourceDetail => ({
  ...toSource(row),
  extractedText: row.extracted_text,
  hasFile: Boolean(row.file_path),
  pageCount: row.page_count,
  errorMessage: row.error_message,
});

const insertSource = db.prepare(
  `INSERT INTO sources
     (id, user_id, notebook_id, kind, title, url, video_id, content, preview,
      file_name, file_path, file_size, mime_type, status, created_at)
   VALUES
     (@id, @user_id, @notebook_id, @kind, @title, @url, @video_id, @content, @preview,
      @file_name, @file_path, @file_size, @mime_type, @status, @created_at)`,
);

const selectById = db.prepare<[string]>('SELECT * FROM sources WHERE id = ?');
const deleteById = db.prepare<[string]>('DELETE FROM sources WHERE id = ?');
const updateStatusById = db.prepare<[SourceStatus, string]>(
  'UPDATE sources SET status = ? WHERE id = ?',
);

const PREVIEW_LENGTH = 240;
const truncate = (value: string, length = PREVIEW_LENGTH): string =>
  value.length <= length ? value : `${value.slice(0, length - 1).trimEnd()}…`;

/**
 * Starts a row for a new source, after checking the target notebook is real and
 * belongs to the caller. Every create path goes through here, so an unowned or
 * made-up `notebookId` is rejected before anything is written or queued.
 */
function baseRow(
  userId: string,
  notebookId: string,
  kind: SourceKind,
  title: string,
): SourceRow {
  assertOwned(notebookId, userId);

  return {
    id: randomUUID(),
    user_id: userId,
    notebook_id: notebookId,
    kind,
    title,
    url: null,
    video_id: null,
    content: null,
    preview: null,
    file_name: null,
    file_path: null,
    file_size: null,
    mime_type: null,
    // When RAG is on, a source starts life queued for embedding; it flips to
    // 'ready' (or 'failed') once background ingestion finishes.
    status: env.ragEnabled ? 'processing' : 'ready',
    created_at: new Date().toISOString(),
  };
}

export function listSources(userId: string, options: ListSourcesQuery): Source[] {
  assertOwned(options.notebookId, userId);

  // Both columns, not just the notebook: ownership is already established, and
  // the redundant `user_id` keeps the query honest if a notebook_id ever leaks
  // in from somewhere that skipped the check.
  const clauses = ['user_id = ?', 'notebook_id = ?'];
  const values: unknown[] = [userId, options.notebookId];

  if (options.kind) {
    clauses.push('kind = ?');
    values.push(options.kind);
  }
  if (options.q) {
    clauses.push('(title LIKE ? OR preview LIKE ? OR url LIKE ?)');
    const like = `%${options.q}%`;
    values.push(like, like, like);
  }

  const rows = db
    .prepare(`SELECT * FROM sources WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`)
    .all(...values) as SourceRow[];

  return rows.map(toSource);
}

export function createTextSource(userId: string, input: CreateTextSourceInput): Source {
  const row = baseRow(userId, input.notebookId, 'text', input.title);
  row.content = input.content;
  row.preview = truncate(input.plainText || input.title);

  insertSource.run(row);
  touchNotebook(row.notebook_id);
  scheduleIngestion(row.id);
  return toSource(row);
}

export function createWebsiteSource(userId: string, input: CreateWebsiteSourceInput): Source {
  const url = new URL(input.url);
  // Fall back to a readable label derived from the URL when none was supplied;
  // fetching the real <title> would mean a server-side request to a user-controlled host.
  const derivedTitle = `${url.hostname.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}`;

  const row = baseRow(userId, input.notebookId, 'website', input.title || truncate(derivedTitle, 80));
  row.url = input.url;
  row.preview = input.url;

  insertSource.run(row);
  touchNotebook(row.notebook_id);
  scheduleIngestion(row.id);
  return toSource(row);
}

export function createYouTubeSource(userId: string, input: CreateYouTubeSourceInput): Source {
  const videoId = parseYouTubeId(input.url);
  if (!videoId) {
    throw ApiError.badRequest('That is not a valid YouTube video URL');
  }

  const row = baseRow(userId, input.notebookId, 'youtube', input.title || `YouTube video ${videoId}`);
  row.url = `https://www.youtube.com/watch?v=${videoId}`;
  row.video_id = videoId;
  row.preview = row.url;

  insertSource.run(row);
  touchNotebook(row.notebook_id);
  scheduleIngestion(row.id);
  return toSource(row);
}

export function createFileSources(
  userId: string,
  notebookId: string,
  kind: FileSourceKind,
  files: Express.Multer.File[],
): Source[] {
  // One transaction for the batch: either every file is recorded or none is,
  // so the uploaded bytes never outlive a partially failed insert.
  const insertAll = db.transaction((batch: Express.Multer.File[]) => {
    const created: Source[] = [];
    for (const file of batch) {
      const row = baseRow(userId, notebookId, kind, file.originalname);
      row.file_name = file.originalname;
      row.file_path = file.path;
      row.file_size = file.size;
      row.mime_type = file.mimetype;
      row.preview = file.originalname;

      insertSource.run(row);
      created.push(toSource(row));
    }
    return created;
  });

  const created = insertAll(files);
  touchNotebook(notebookId);
  // Kick off ingestion only after the batch has committed, so a rolled-back
  // insert never leaves a half-embedded source behind.
  for (const source of created) scheduleIngestion(source.id);
  return created;
}

/**
 * Reads one source, rejecting anything the caller does not own. Another user's
 * source reports as missing rather than forbidden, so ids cannot be probed.
 */
function ownedRow(id: string, userId: string): SourceDetailRow {
  const row = selectById.get(id) as SourceDetailRow | undefined;
  if (!row || row.user_id !== userId) {
    throw ApiError.notFound('Source not found');
  }
  return row;
}

/**
 * One source with the text a citation's offsets address — what the source
 * viewer loads when a reference is opened.
 */
export function getSourceDetail(id: string, userId: string): SourceDetail {
  return toSourceDetail(ownedRow(id, userId));
}

/** The bytes behind an uploaded source, for streaming the original back. */
export function getSourceFile(
  id: string,
  userId: string,
): { path: string; mimeType: string; fileName: string } {
  const row = ownedRow(id, userId);
  if (!row.file_path) {
    throw ApiError.notFound('This source has no original file');
  }
  // The row can outlive the bytes if the uploads directory was cleared; saying
  // so beats a stream that errors halfway through a 200 response.
  if (!fs.existsSync(row.file_path)) {
    throw ApiError.notFound('The original file is no longer on disk');
  }

  return {
    path: row.file_path,
    mimeType: row.mime_type ?? 'application/octet-stream',
    fileName: row.file_name ?? row.title,
  };
}

/**
 * The ids retrieval is allowed to search, for a question asked in `notebookId`.
 *
 * This is where notebook isolation is enforced for chat. Only `ready` sources
 * are listed — one still indexing has no vectors, and a failed one has stale or
 * none — and an optional client-supplied `restrictTo` narrows further, always
 * by intersection, so ids belonging to another notebook cannot widen the scope.
 */
export function retrievableSourceIds(
  notebookId: string,
  userId: string,
  restrictTo?: string[],
): string[] {
  assertOwned(notebookId, userId);

  const rows = db
    .prepare<[string, string]>(
      `SELECT id FROM sources
        WHERE notebook_id = ? AND user_id = ? AND status = 'ready'
        ORDER BY created_at DESC`,
    )
    .all(notebookId, userId) as Array<{ id: string }>;

  const ids = rows.map((row) => row.id);
  if (!restrictTo || restrictTo.length === 0) return ids;

  const allowed = new Set(restrictTo);
  return ids.filter((id) => allowed.has(id));
}

/**
 * Re-runs the ingestion pipeline for an existing source: extract, chunk and
 * embed it again. Used to recover a `failed` source, or to pick up a changed
 * website / new embedding settings. `prepareSource` drops the old vectors
 * first, so a re-index replaces the source's points rather than duplicating
 * them.
 */
export function reindexSource(id: string, userId: string): Source {
  const row = ownedRow(id, userId);

  if (!env.ragEnabled) {
    throw ApiError.badRequest('Re-indexing is unavailable while retrieval is disabled');
  }
  // A second job for a source already in flight would race the first: one run
  // clears the vectors the other is still writing.
  if (row.status === 'processing') {
    throw ApiError.conflict('This source is already being indexed');
  }

  // Flip the status before enqueueing so the client starts polling straight
  // away instead of waiting for the worker to pick the job up.
  updateStatusById.run('processing', id);
  row.status = 'processing';
  scheduleIngestion(id);

  logger.info('Source re-index requested', { sourceId: id, kind: row.kind });
  return toSource(row);
}

export function deleteSource(id: string, userId: string): void {
  const row = ownedRow(id, userId);

  deleteById.run(id);
  touchNotebook(row.notebook_id);

  if (row.file_path) {
    fs.rm(row.file_path, { force: true }, () => {});
  }

  // Best-effort: drop the source's vectors from Qdrant. A failure here (e.g.
  // Qdrant down) must not fail the delete — the row is already gone.
  if (env.ragEnabled) {
    void deleteSourceVectors(id).catch((error: unknown) => {
      logger.warn('Failed to delete source vectors', { id, error: (error as Error).message });
    });
  }
}
