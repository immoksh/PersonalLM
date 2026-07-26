import type { SourceStatus } from '@personallm/shared';
import { db } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { chunkText } from './chunk.js';
import { extractText } from './extract.js';
import { ExtractionError, type ExtractableSource } from './parsers/types.js';
import { deleteSourceVectors, type SourceRef } from './vectorStore.js';

/**
 * Ingestion runs in two queued stages:
 *
 *   1. `prepareSource` — extract text and split it into chunks (this module,
 *      run by the source-ingestion worker).
 *   2. embed + upsert — one job per batch of chunks on the embedding queue,
 *      so batches for a big source are embedded in parallel and a failed
 *      OpenAI/Qdrant call retries just that batch instead of re-downloading
 *      and re-chunking the whole source.
 *
 * The source row's status follows the whole pipeline: `processing` while stage
 * one runs, `ready` once every batch has been embedded, `failed` if either
 * stage gives up.
 */

interface IngestRow extends ExtractableSource {
  user_id: string;
}

/** Stage-one output: what the embedding jobs need to do their work. */
export interface PreparedSource {
  ref: SourceRef;
  chunks: string[];
}

const selectRow = db.prepare<[string]>(
  `SELECT id, user_id, kind, title, url, video_id, content, file_path
     FROM sources WHERE id = ?`,
);
const updateStatus = db.prepare<[SourceStatus, string]>(
  'UPDATE sources SET status = ? WHERE id = ?',
);

/**
 * Extracts and chunks one source, and clears any vectors it already has so
 * re-ingesting replaces them rather than accumulating duplicates. Returns null
 * when the source was deleted before its job ran. Throws when the source yields
 * no readable text, so it is marked `failed` rather than "ready, empty".
 */
export async function prepareSource(sourceId: string): Promise<PreparedSource | null> {
  const row = selectRow.get(sourceId) as IngestRow | undefined;
  if (!row) {
    logger.warn('Ingestion skipped: source no longer exists', { sourceId });
    return null;
  }

  setStatus(sourceId, 'processing');

  const text = await extractText(row);
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new ExtractionError('No readable text could be extracted from this source');
  }

  // Done once here, before any batch is queued: the batches themselves upsert
  // by deterministic id and must not delete each other's points.
  await deleteSourceVectors(sourceId);

  const ref: SourceRef = {
    sourceId,
    userId: row.user_id,
    kind: row.kind,
    title: row.title,
  };
  logger.info('Source prepared for embedding', { sourceId, kind: row.kind, chunks: chunks.length });
  return { ref, chunks };
}

/** Marks a source ready once every one of its embedding batches has completed. */
export function completeIngestion(sourceId: string, chunkCount: number): void {
  setStatus(sourceId, 'ready');
  logger.info('Source ingested', { sourceId, chunks: chunkCount });
}

/** Marks a source failed after either stage exhausts its retries. */
export function failIngestion(sourceId: string): void {
  setStatus(sourceId, 'failed');
}

function setStatus(sourceId: string, status: SourceStatus): void {
  // The row may have been deleted mid-ingest; the update simply affects no rows.
  updateStatus.run(status, sourceId);
}
