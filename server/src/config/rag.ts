import { env } from './env.js';

/**
 * Grouped RAG tunables, so call sites read `config.chunking.chunkSize` rather
 * than reaching into the flat env object. Values come from the environment
 * (see `.env.example`) with sensible defaults.
 */
export const config = {
  chunking: {
    chunkSize: env.CHUNK_SIZE,
    chunkOverlap: env.CHUNK_OVERLAP,
  },
  embedding: {
    /** Chunks per queued embedding job (see `queue/embedding.ts`). */
    batchSize: env.EMBED_BATCH_SIZE,
  },
  openai: {
    chatModel: env.OPENAI_CHAT_MODEL,
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
    /** Vector size the collection is created with, and what the embedding
     *  model is asked for when it supports truncation. */
    embeddingDimensions: env.embeddingDimensions,
  },
  retrieval: {
    /** Per-variant search depth, before Reciprocal Rank Fusion. */
    topK: env.RETRIEVAL_TOP_K,
    /** How many fused chunks are handed to the chat model as context. */
    finalK: env.RETRIEVAL_FINAL_K,
    /** The `k` in RRF's `1 / (k + rank)`. */
    rrfK: env.RETRIEVAL_RRF_K,
    /** Number of sub-questions the rewriting step decomposes a query into. */
    subQueryCount: env.RETRIEVAL_SUB_QUERIES,
  },
  qdrant: {
    url: env.QDRANT_URL,
    apiKey: env.QDRANT_API_KEY,
    collection: env.QDRANT_COLLECTION,
  },
} as const;
