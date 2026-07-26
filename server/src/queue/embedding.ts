import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { JobsOptions, ParentOptions } from 'bullmq';
import { config } from '../config/rag.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { failIngestion } from '../modules/rag/ingest.js';
import type { LocatedChunk } from '../modules/rag/chunk.js';
import { upsertChunkBatch, type QueuedChunk, type SourceRef } from '../modules/rag/vectorStore.js';
import { createRedisConnection } from './connection.js';

const QUEUE_NAME = 'chunk-embedding';

export interface EmbeddingJobData extends SourceRef {
  startIndex: number;
  /** Written as `LocatedChunk[]`; read as `QueuedChunk[]`, since jobs queued by
   *  an earlier version are still in Redis after a deploy. */
  chunks: QueuedChunk[];
}

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
  failParentOnFailure: true,
};

let queue: Queue<EmbeddingJobData> | null = null;
let queueConnection: Redis | null = null;
let worker: Worker<EmbeddingJobData> | null = null;
let workerConnection: Redis | null = null;

function getQueue(): Queue<EmbeddingJobData> {
  if (!queue) {
    queueConnection = createRedisConnection();
    queue = new Queue<EmbeddingJobData>(QUEUE_NAME, { connection: queueConnection });
  }
  return queue;
}

export async function enqueueEmbeddingBatches(
  ref: SourceRef,
  chunks: LocatedChunk[],
  parent: ParentOptions,
): Promise<number> {
  const { batchSize } = config.embedding;
  const jobs: { name: string; data: EmbeddingJobData; opts: JobsOptions }[] = [];

  for (let startIndex = 0; startIndex < chunks.length; startIndex += batchSize) {
    jobs.push({
      name: 'embed',
      data: { ...ref, startIndex, chunks: chunks.slice(startIndex, startIndex + batchSize) },
      opts: { ...JOB_OPTIONS, parent },
    });
  }

  await getQueue().addBulk(jobs);
  logger.info('Embedding batches enqueued', {
    sourceId: ref.sourceId,
    batches: jobs.length,
    chunks: chunks.length,
  });
  return jobs.length;
}

export function startEmbeddingWorker(): Worker<EmbeddingJobData> | null {
  if (!env.ragEnabled) return null;
  if (worker) return worker;

  workerConnection = createRedisConnection();
  worker = new Worker<EmbeddingJobData>(
    QUEUE_NAME,
    async (job: Job<EmbeddingJobData>) => {
      const { startIndex, chunks, ...ref } = job.data;
      return upsertChunkBatch(ref, chunks, startIndex);
    },
    { connection: workerConnection, concurrency: env.EMBED_CONCURRENCY },
  );

  worker.on('failed', (job, error) => {
    logger.error('Embedding job failed', {
      sourceId: job?.data.sourceId,
      jobId: job?.id,
      startIndex: job?.data.startIndex,
      attempts: job?.attemptsMade,
      error: error.message,
    });
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      failIngestion(job.data.sourceId, `Embedding failed: ${error.message}`);
    }
  });
  worker.on('error', (error) => logger.error('Embedding worker error', { error: error.message }));

  logger.info('Embedding worker started', {
    concurrency: env.EMBED_CONCURRENCY,
    batchSize: config.embedding.batchSize,
  });
  return worker;
}

export async function closeEmbedding(): Promise<void> {
  await worker?.close();
  await queue?.close();
  workerConnection?.disconnect();
  queueConnection?.disconnect();
  worker = null;
  queue = null;
  workerConnection = null;
  queueConnection = null;
}
