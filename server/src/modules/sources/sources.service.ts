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
  type SourceKind,
  type SourceStatus,
} from '@personallm/shared';
import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { ApiError } from '../../utils/ApiError.js';
import { scheduleIngestion } from '../../queue/index.js';
import { deleteSourceVectors } from '../rag/vectorStore.js';

interface SourceRow {
  id: string;
  user_id: string;
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

/** `file_path` and raw `content` stay server-side; the client gets a preview. */
const toSource = (row: SourceRow): Source => ({
  id: row.id,
  userId: row.user_id,
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

const insertSource = db.prepare(
  `INSERT INTO sources
     (id, user_id, kind, title, url, video_id, content, preview,
      file_name, file_path, file_size, mime_type, status, created_at)
   VALUES
     (@id, @user_id, @kind, @title, @url, @video_id, @content, @preview,
      @file_name, @file_path, @file_size, @mime_type, @status, @created_at)`,
);

const selectById = db.prepare<[string]>('SELECT * FROM sources WHERE id = ?');
const deleteById = db.prepare<[string]>('DELETE FROM sources WHERE id = ?');

const PREVIEW_LENGTH = 240;
const truncate = (value: string, length = PREVIEW_LENGTH): string =>
  value.length <= length ? value : `${value.slice(0, length - 1).trimEnd()}…`;

function baseRow(userId: string, kind: SourceKind, title: string): SourceRow {
  return {
    id: randomUUID(),
    user_id: userId,
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
  const clauses = ['user_id = ?'];
  const values: unknown[] = [userId];

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
  const row = baseRow(userId, 'text', input.title);
  row.content = input.content;
  row.preview = truncate(input.plainText || input.title);

  insertSource.run(row);
  scheduleIngestion(row.id);
  return toSource(row);
}

export function createWebsiteSource(userId: string, input: CreateWebsiteSourceInput): Source {
  const url = new URL(input.url);
  // Fall back to a readable label derived from the URL when none was supplied;
  // fetching the real <title> would mean a server-side request to a user-controlled host.
  const derivedTitle = `${url.hostname.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}`;

  const row = baseRow(userId, 'website', input.title || truncate(derivedTitle, 80));
  row.url = input.url;
  row.preview = input.url;

  insertSource.run(row);
  scheduleIngestion(row.id);
  return toSource(row);
}

export function createYouTubeSource(userId: string, input: CreateYouTubeSourceInput): Source {
  const videoId = parseYouTubeId(input.url);
  if (!videoId) {
    throw ApiError.badRequest('That is not a valid YouTube video URL');
  }

  const row = baseRow(userId, 'youtube', input.title || `YouTube video ${videoId}`);
  row.url = `https://www.youtube.com/watch?v=${videoId}`;
  row.video_id = videoId;
  row.preview = row.url;

  insertSource.run(row);
  scheduleIngestion(row.id);
  return toSource(row);
}

export function createFileSources(
  userId: string,
  kind: FileSourceKind,
  files: Express.Multer.File[],
): Source[] {
  // One transaction for the batch: either every file is recorded or none is,
  // so the uploaded bytes never outlive a partially failed insert.
  const insertAll = db.transaction((batch: Express.Multer.File[]) => {
    const created: Source[] = [];
    for (const file of batch) {
      const row = baseRow(userId, kind, file.originalname);
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
  // Kick off ingestion only after the batch has committed, so a rolled-back
  // insert never leaves a half-embedded source behind.
  for (const source of created) scheduleIngestion(source.id);
  return created;
}

export function deleteSource(id: string, userId: string): void {
  const row = selectById.get(id) as SourceRow | undefined;
  // Another user's source reports as missing rather than forbidden, so ids
  // cannot be probed.
  if (!row || row.user_id !== userId) {
    throw ApiError.notFound('Source not found');
  }

  deleteById.run(id);

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
