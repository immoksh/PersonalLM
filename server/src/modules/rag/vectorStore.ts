import { createHash } from 'node:crypto';
import { Document } from '@langchain/core/documents';
import { QdrantVectorStore } from '@langchain/qdrant';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { SourceKind } from '@personallm/shared';
import { config } from '../../config/rag.js';
import { logger } from '../../utils/logger.js';
import { getEmbeddings } from './models.js';

/** Identifying fields copied onto every chunk's payload for a source. */
export interface SourceRef {
  userId: string;
  sourceId: string;
  kind: SourceKind;
  title: string;
}

/** Payload stored alongside every chunk vector, used for filtering and citations. */
export interface ChunkMetadata extends SourceRef {
  /** Position of this chunk within its source, for stable ordering/debugging. */
  chunkIndex: number;
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
          // Cosine matches how OpenAI embeddings are meant to be compared.
          distance: 'Cosine',
        },
      });
      logger.info('Created Qdrant collection', {
        collection: name,
        size: config.openai.embeddingDimensions,
      });
    } catch (error) {
      // Another worker may have created it first (409 Conflict); only a
      // collection that is *still* missing means the failure was real.
      const stillMissing = !(await qdrant.collectionExists(name)).exists;
      if (stillMissing) throw error;
    }
  } else {
    await assertVectorSize(name);
  }

  // Also for collections that predate the indexes, hence outside the branch.
  await ensurePayloadIndexes(name);
  return name;
}

/**
 * The payload fields every search filters on.
 *
 * Qdrant applies a filter correctly with or without an index, so this is not what
 * keeps one user's chunks out of another's answers — `buildConditions` in
 * `query.ts` does that. What the index buys is *recall*. Filtering an HNSW graph
 * on an unindexed field makes the traversal walk through points that are then all
 * discarded, and `userId` is the most selective filter here once more than one
 * user shares the collection: the search spends its budget among other users'
 * vectors and returns fewer of the asking user's own chunks than exist. An
 * indexed field lets Qdrant build the filterable sub-graph instead, so a user
 * with a small library still gets their best passages back once the collection
 * grows past `indexing_threshold`.
 */
const INDEXED_PAYLOAD_FIELDS = ['metadata.userId', 'metadata.sourceId'] as const;

/** Declares those indexes. Idempotent: re-declaring an identical one is a no-op. */
async function ensurePayloadIndexes(name: string): Promise<void> {
  const qdrant = getQdrantClient();

  for (const field of INDEXED_PAYLOAD_FIELDS) {
    try {
      // `wait` so the index is in place before the first search runs against a
      // freshly created collection, rather than the opening queries going
      // unindexed while Qdrant applies it in the background.
      await qdrant.createPayloadIndex(name, {
        field_name: field,
        field_schema: 'keyword',
        wait: true,
      });
    } catch (error) {
      // Not fatal — retrieval stays correctly scoped, just unindexed — so this
      // must not stop the store from booting. Logged rather than swallowed,
      // because the cost is silent: slower searches and thinner results.
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
  chunks: string[],
  startIndex: number,
): Promise<number> {
  if (chunks.length === 0) return 0;
  const store = await getVectorStore();

  const documents = chunks.map(
    (chunk, offset) =>
      new Document<ChunkMetadata>({
        pageContent: chunk,
        metadata: { ...source, chunkIndex: startIndex + offset },
      }),
  );
  // Deterministic ids make a retried batch overwrite its own points instead of
  // inserting a second copy — Qdrant upserts by id.
  const ids = documents.map((_, offset) => chunkPointId(source.sourceId, startIndex + offset));
  // addDocuments embeds each chunk (OpenAI) and upserts the vectors into Qdrant.
  await store.addDocuments(documents, { ids });
  return documents.length;
}

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
  await getQdrantClient().delete(config.qdrant.collection, {
    wait: true,
    filter: { must: [{ key: 'metadata.sourceId', match: { value: sourceId } }] },
  });
}
