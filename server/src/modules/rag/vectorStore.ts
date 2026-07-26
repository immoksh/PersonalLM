import { createHash } from 'node:crypto';
import { Document } from '@langchain/core/documents';
import { QdrantVectorStore } from '@langchain/qdrant';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { SourceKind } from '@personallm/shared';
import { config } from '../../config/rag.js';
import { logger } from '../../utils/logger.js';
import type { LocatedChunk } from './chunk.js';
import { getEmbeddings } from './models.js';

/** Identifying fields copied onto every chunk's payload for a source. */
export interface SourceRef {
  userId: string;
  notebookId: string;
  sourceId: string;
  kind: SourceKind;
  title: string;
}

/**
 * Payload stored alongside every chunk vector, used for filtering and citations.
 *
 * The locator fields are carried here rather than looked up later because the
 * vector *is* the chunk: nothing else in the system knows which page or which
 * second a given passage came from once ingestion has finished.
 */
export interface ChunkMetadata extends SourceRef {
  /** Position of this chunk within its source, for stable ordering/debugging. */
  chunkIndex: number;
  /** Offsets into the source's stored extracted text. */
  charStart: number;
  charEnd: number;
  page: number | null;
  startSec: number | null;
  endSec: number | null;
  [key: string]: unknown;
}

let client: QdrantClient | null = null;
let storePromise: Promise<QdrantVectorStore> | null = null;

export function getQdrantClient(): QdrantClient {
  client ??= new QdrantClient({ url: config.qdrant.url, apiKey: config.qdrant.apiKey });
  return client;
}

/**
 * Creates the collection if it isn't there yet, sized to the embedding model's
 * output, and returns its name. Safe to call from every worker on every boot:
 * it is idempotent, and tolerates losing the creation race to another process.
 */
export async function ensureCollection(): Promise<string> {
  const name = config.qdrant.collection;
  const qdrant = getQdrantClient();
  const { exists } = await qdrant.collectionExists(name);

  if (!exists) {
    try {
      await qdrant.createCollection(name, {
        vectors: {
          size: config.openai.embeddingDimensions,
          distance: 'Cosine',
        },
      });
      logger.info('Created Qdrant collection', {
        collection: name,
        size: config.openai.embeddingDimensions,
      });
    } catch (error) {
      const stillMissing = !(await qdrant.collectionExists(name)).exists;
      if (stillMissing) throw error;
    }
  } else {
    await assertVectorSize(name);
  }

  await ensurePayloadIndexes(name);
  return name;
}

const INDEXED_PAYLOAD_FIELDS = ['metadata.userId', 'metadata.sourceId'] as const;

async function ensurePayloadIndexes(name: string): Promise<void> {
  const qdrant = getQdrantClient();

  for (const field of INDEXED_PAYLOAD_FIELDS) {
    try {
      await qdrant.createPayloadIndex(name, {
        field_name: field,
        field_schema: 'keyword',
        wait: true,
      });
    } catch (error) {
      logger.warn('Could not create Qdrant payload index', {
        collection: name,
        field,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Guards the case where an existing collection was built for a different
 * embedding model: Qdrant would otherwise reject every upsert with a shape
 * error that says nothing about the cause.
 */
async function assertVectorSize(name: string): Promise<void> {
  const info = await getQdrantClient().getCollection(name);
  const vectors = info.config?.params?.vectors;
  // Only the unnamed single-vector layout (what we create) can be checked.
  const size = vectors && typeof vectors === 'object' && 'size' in vectors ? vectors.size : null;
  const expected = config.openai.embeddingDimensions;

  if (typeof size === 'number' && size !== expected) {
    throw new Error(
      `Qdrant collection "${name}" stores ${size}-dimension vectors, but ${config.openai.embeddingModel} ` +
        `produces ${expected}. Point QDRANT_COLLECTION at a new collection (or drop this one) and re-ingest.`,
    );
  }
}

/**
 * Returns the shared vector store, ensuring the collection exists on first use.
 * The in-flight promise is cached so concurrent callers share a single
 * `ensureCollection` round-trip.
 */
export function getVectorStore(): Promise<QdrantVectorStore> {
  storePromise ??= (async () => {
    const store = new QdrantVectorStore(getEmbeddings(), {
      client: getQdrantClient(),
      collectionName: await ensureCollection(),
    });
    return store;
  })().catch((error: unknown) => {
    // Don't cache a failed init — a later request (e.g. once Qdrant is up) retries.
    storePromise = null;
    throw error;
  });
  return storePromise;
}

/**
 * Embeds one batch of a source's chunks and upserts them as vectors.
 * `startIndex` is the batch's offset within the source, so `chunkIndex` stays
 * meaningful across the batches that are embedded in parallel by the embedding
 * queue. Callers clear the source's prior vectors once (`deleteSourceVectors`)
 * before the first batch. Returns the number upserted.
 */
export async function upsertChunkBatch(
  source: SourceRef,
  chunks: QueuedChunk[],
  startIndex: number,
): Promise<number> {
  if (chunks.length === 0) return 0;
  const store = await getVectorStore();

  const documents: Array<Document<ChunkMetadata>> = [];
  const ids: string[] = [];

  chunks.forEach((queued, offset) => {
    const { text, ...locator } = normalizeChunk(queued);
    const chunkIndex = startIndex + offset;

    // An empty chunk is rejected by the embeddings API with a message that says
    // nothing about which source or batch produced it, so it is dropped here —
    // there is nothing to retrieve in it either way. `chunkIndex` still advances
    // with the batch offset, so the remaining points keep their stable ids.
    if (!text) {
      logger.warn('Skipping empty chunk', { sourceId: source.sourceId, chunkIndex });
      return;
    }

    documents.push(
      new Document<ChunkMetadata>({
        pageContent: text,
        metadata: { ...source, ...locator, chunkIndex },
      }),
    );
    // Deterministic ids make a retried batch overwrite its own points instead of
    // inserting a second copy — Qdrant upserts by id.
    ids.push(chunkPointId(source.sourceId, chunkIndex));
  });

  if (documents.length === 0) return 0;
  // addDocuments embeds each chunk (OpenAI) and upserts the vectors into Qdrant.
  await store.addDocuments(documents, { ids });
  return documents.length;
}

/**
 * A chunk as it arrives off the queue.
 *
 * Jobs outlive the code that enqueued them: a deploy that changes this payload
 * finds the previous version's jobs still in Redis, and workers can run mixed
 * versions during a rolling restart. Before chunks carried locators they were
 * plain strings, so both shapes have to be readable — otherwise a legacy job
 * destructures to `undefined` text and fails the whole source with an opaque
 * "input cannot be an empty string" from the embeddings API.
 */
export type QueuedChunk = LocatedChunk | string;

/** Widens a legacy string chunk to a located one with no known position. */
function normalizeChunk(chunk: QueuedChunk): LocatedChunk {
  if (typeof chunk !== 'string') return chunk;
  return { text: chunk, charStart: 0, charEnd: 0, page: null, startSec: null, endSec: null };
}

/** Internals exposed for unit tests only. */
export const __testing = { normalizeChunk };

/** Stable point id for one chunk. Qdrant ids must be a UUID or unsigned int. */
function chunkPointId(sourceId: string, chunkIndex: number): string {
  const hex = createHash('sha1').update(`${sourceId}:${chunkIndex}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Removes every chunk belonging to a source. Deleting by payload filter (rather
 * than by point id) means we never have to track the generated chunk ids.
 */
export async function deleteSourceVectors(sourceId: string): Promise<void> {
  // `ensureCollection` rather than the configured name directly: ingestion
  // clears a source's old vectors *before* the first batch is embedded, so on a
  // brand-new deployment this is the first Qdrant call of all — and deleting
  // from a collection that does not exist yet is a 404 that fails the whole
  // ingestion. Creating it here is idempotent and costs one existence check.
  const collection = await ensureCollection();
  await getQdrantClient().delete(collection, {
    wait: true,
    filter: { must: [{ key: 'metadata.sourceId', match: { value: sourceId } }] },
  });
}

/**
 * Removes the vectors of several sources at once — what deleting a whole
 * notebook needs. Filtered on the source ids rather than `notebookId` so it
 * also catches points indexed before notebooks existed, which carry no
 * notebook in their payload.
 */
export async function deleteVectorsForSources(sourceIds: string[]): Promise<void> {
  if (sourceIds.length === 0) return;
  const collection = await ensureCollection();
  await getQdrantClient().delete(collection, {
    wait: true,
    filter: { must: [{ key: 'metadata.sourceId', match: { any: sourceIds } }] },
  });
}
