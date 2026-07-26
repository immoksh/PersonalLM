import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repo root, from either `src/config` (tsx) or `dist/config` (compiled). */
export const ROOT_DIR = path.resolve(here, '../../..');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  /** OAuth client id from Google Cloud Console. Sign-in fails without it. */
  GOOGLE_CLIENT_ID: z.string().optional(),
  DATABASE_FILE: z.string().default('data/app.sqlite'),
  UPLOAD_DIR: z.string().default('data/uploads'),

  // --- RAG (LangChain + OpenAI + Qdrant) ---
  /** Enables embedding/retrieval/chat. Without it, sources are stored but never
   *  processed, and the chat endpoint returns a clear "not configured" error. */
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_CHAT_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  /** Vector size the Qdrant collection is created with. Optional for the models
   *  below, which we already know the dimensions of; the `text-embedding-3`
   *  models also accept it as a request to truncate their output. */
  OPENAI_EMBEDDING_DIMENSIONS: z.preprocess(
    // `FOO=` in a .env file arrives as an empty string, which would coerce to 0.
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().min(1).max(8192).optional(),
  ),
  /** Qdrant REST endpoint. Defaults to the local docker-compose service. */
  QDRANT_URL: z.string().url().default('http://localhost:6333'),
  /** Required only by Qdrant Cloud; a local container needs no key. */
  QDRANT_API_KEY: z.preprocess(
    // A blank `QDRANT_API_KEY=` must read as "no key": the Qdrant client keys
    // off `typeof apiKey === 'string'`, so an empty string would still send an
    // `api-key` header and warn about using one over an unsecured connection.
    (value) => (value === '' ? undefined : value),
    z.string().optional(),
  ),
  QDRANT_COLLECTION: z.string().default('personallm_sources'),
  /** Target chunk size (characters) and overlap between adjacent chunks. */
  CHUNK_SIZE: z.coerce.number().int().min(100).max(8000).default(1000),
  CHUNK_OVERLAP: z.coerce.number().int().min(0).max(2000).default(150),

  // --- Retrieval (multi-query + RRF) ---
  /** Chunks each individual query variant retrieves before fusion. */
  RETRIEVAL_TOP_K: z.coerce.number().int().min(1).max(100).default(8),
  /** Chunks kept after fusing every variant's results — the answer's context. */
  RETRIEVAL_FINAL_K: z.coerce.number().int().min(1).max(100).default(6),
  /** RRF damping constant: larger flattens the weight of top ranks. */
  RETRIEVAL_RRF_K: z.coerce.number().int().min(1).max(1000).default(60),
  /** Sub-questions the query is decomposed into during rewriting. */
  RETRIEVAL_SUB_QUERIES: z.coerce.number().int().min(0).max(10).default(3),

  // --- Ingestion queue (BullMQ + Redis) ---
  /** Redis backing the ingestion queue. Defaults to the docker-compose service. */
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  /** How many sources a single worker extracts and chunks concurrently. */
  INGEST_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(2),
  /** Chunks per embedding job. Each batch is one OpenAI call and one Qdrant
   *  upsert, and is retried as a unit, so keep it big enough to amortise the
   *  round-trips but small enough that a retry is cheap. */
  EMBED_BATCH_SIZE: z.coerce.number().int().min(1).max(512).default(64),
  /** How many embedding batches a single worker processes concurrently. */
  EMBED_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
  /** When true, the API process also runs the ingestion worker. Set to `false`
   *  to run workers as separate processes (`npm run start:worker`) and scale
   *  them independently of the API. */
  INGEST_INLINE_WORKER: z
    .string()
    .default('true')
    .transform((value) => value !== 'false'),
});

/**
 * Output dimensions of the embedding models we ship defaults for. The Qdrant
 * collection is created with this size, so a model that isn't listed here has
 * to declare it through OPENAI_EMBEDDING_DIMENSIONS.
 */
const KNOWN_EMBEDDING_DIMENSIONS: Readonly<Record<string, number>> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

function resolveEmbeddingDimensions(model: string, override?: number): number {
  // The refine below guarantees one of the two is present; the final fallback
  // exists only so the resolved value types as a plain number.
  return override ?? KNOWN_EMBEDDING_DIMENSIONS[model] ?? 1536;
}

function loadEnv() {
  // A dev-only fallback so `npm run dev` works before anyone copies .env.example.
  // Never allowed in production: a predictable signing key forges any session.
  if (!process.env.JWT_SECRET && process.env.NODE_ENV !== 'production') {
    process.env.JWT_SECRET = 'dev-only-insecure-secret-do-not-use-in-production';
  }

  const parsed = envSchema
    .refine((value) => value.NODE_ENV !== 'production' || Boolean(value.GOOGLE_CLIENT_ID), {
      // Fail at boot rather than letting every sign-in attempt 500.
      path: ['GOOGLE_CLIENT_ID'],
      message: 'GOOGLE_CLIENT_ID is required in production — Google is the only sign-in method',
    })
    .refine((value) => value.CHUNK_OVERLAP < value.CHUNK_SIZE, {
      path: ['CHUNK_OVERLAP'],
      message: 'CHUNK_OVERLAP must be smaller than CHUNK_SIZE',
    })
    .refine(
      (value) =>
        Boolean(
          value.OPENAI_EMBEDDING_DIMENSIONS ??
          KNOWN_EMBEDDING_DIMENSIONS[value.OPENAI_EMBEDDING_MODEL],
        ),
      {
        // Guessing the wrong size builds a collection every upsert rejects.
        path: ['OPENAI_EMBEDDING_DIMENSIONS'],
        message:
          'Unknown OPENAI_EMBEDDING_MODEL — set OPENAI_EMBEDDING_DIMENSIONS to the vector size it produces',
      },
    )
    .safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}\n\nSee .env.example.`);
  }
  return parsed.data;
}

const parsedEnv = loadEnv();

export const env = {
  ...parsedEnv,
  isProduction: parsedEnv.NODE_ENV === 'production',
  isTest: parsedEnv.NODE_ENV === 'test',
  /** RAG features (embedding, retrieval, chat) require an OpenAI key to work. */
  ragEnabled: Boolean(parsedEnv.OPENAI_API_KEY),
  /** Vector size for the configured embedding model, explicit or well-known. */
  embeddingDimensions: resolveEmbeddingDimensions(
    parsedEnv.OPENAI_EMBEDDING_MODEL,
    parsedEnv.OPENAI_EMBEDDING_DIMENSIONS,
  ),
  /** Absolute path to the SQLite file (`:memory:` is passed through untouched). */
  databasePath:
    parsedEnv.DATABASE_FILE === ':memory:'
      ? ':memory:'
      : path.resolve(ROOT_DIR, parsedEnv.DATABASE_FILE),
} as const;

export type Env = typeof env;
