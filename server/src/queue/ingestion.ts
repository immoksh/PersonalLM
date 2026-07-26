import { Queue, WaitingChildrenError, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { SourceStatus } from '@personallm/shared';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { db } from '../db/index.js';
import { completeIngestion, failIngestion, prepareSource } from '../modules/rag/ingest.js';
import { enqueueEmbeddingBatches } from './embedding.js';
import { createRedisConnection } from './connection.js';

/**
 * The ingestion queue decouples source creation from the slow work of
 * extracting, chunking, embedding, and upserting into Qdrant. Producers
 * (`scheduleIngestion`) enqueue a job per source; the worker
 * (`startIngestionWorker`) processes them with bounded concurrency and
 * automatic retries.
 *
 * A job runs in two steps. It first extracts and chunks the source, fans the
 * chunks out as child jobs on the embedding queue, and parks itself in
 * waiting-children. BullMQ re-runs the processor once every child has
 * completed, and the second step marks the source `ready`.
 */

const QUEUE_NAME = 'source-ingestion';

interface IngestionJobData {
  sourceId: string;
  /** Which step to run; absent on a freshly enqueued job. BullMQ re-runs the
   *  processor from the top when the children finish, so the step is persisted
   *  on the job rather than kept in memory. */
  step?: 'embedding';
  /** Chunk count recorded by the first step, for logging in the second. */
  chunkCount?: number;
}

const JOB_OPTIONS = {
  attempts: 3,
  // Space retries out (5s, 10s, 20s) so a transient Qdrant/OpenAI blip recovers.
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
};

const markFailed = db.prepare<[SourceStatus, string]>('UPDATE sources SET status = ? WHERE id = ?');

let queue: Queue<IngestionJobData> | null = null;
let queueConnection: Redis | null = null;
let worker: Worker<IngestionJobData> | null = null;
let workerConnection: Redis | null = null;

function getQueue(): Queue<IngestionJobData> {
  if (!queue) {
    queueConnection = createRedisConnection();
    queue = new Queue<IngestionJobData>(QUEUE_NAME, { connection: queueConnection });
  }
  return queue;
}

/**
 * Enqueues background ingestion for a freshly created source. Fire-and-forget:
 * a failure to enqueue is logged and the source is marked `failed` rather than
 * left stuck in `processing`. No-op when RAG is disabled (nothing to embed).
 */
export function scheduleIngestion(sourceId: string): void {
  if (!env.ragEnabled) return;
  void getQueue()
    .add('ingest', { sourceId }, JOB_OPTIONS)
    .catch((error: unknown) => {
      logger.error('Failed to enqueue ingestion job', {
        sourceId,
        error: (error as Error).message,
      });
      markFailed.run('failed', sourceId);
    });
}

/**
 * Runs one source through the pipeline. Returns the number of chunks indexed.
 * Throws `WaitingChildrenError` — which BullMQ handles rather than treating as
 * a failure — while the source's embedding batches are still in flight.
 */
async function processIngestion(job: Job<IngestionJobData>, token?: string): Promise<number> {
  const { sourceId } = job.data;

  if (job.data.step !== 'embedding') {
    const prepared = await prepareSource(sourceId);
    if (!prepared) return 0; // Source was deleted before its job ran.

    if (!token) {
      // Without a lock token the job cannot park itself, and finishing here
      // would mark the source ready before a single batch had been embedded.
      throw new Error('Ingestion job has no lock token; cannot await embedding batches');
    }

    const chunkCount = prepared.chunks.length;
    const batches = await enqueueEmbeddingBatches(prepared.ref, prepared.chunks, {
      id: job.id!,
      queue: job.queueQualifiedName,
    });
    // Persist the step before parking, so the re-run resumes at the second step
    // instead of extracting and re-queueing the source all over again.
    await job.updateData({ sourceId, step: 'embedding', chunkCount });

    if (batches > 0 && (await job.moveToWaitingChildren(token))) {
      throw new WaitingChildrenError();
    }
  }

  // Every batch has been embedded and upserted.
  const chunkCount = job.data.chunkCount ?? 0;
  completeIngestion(sourceId, chunkCount);
  return chunkCount;
}

/**
 * Starts the worker that drains the queue. Returns null when RAG is disabled
 * (no embeddings to compute) so callers can start it unconditionally.
 */
export function startIngestionWorker(): Worker<IngestionJobData> | null {
  if (!env.ragEnabled) {
    logger.warn('Ingestion worker not started: RAG is disabled (no OPENAI_API_KEY)');
    return null;
  }
  if (worker) return worker;

  workerConnection = createRedisConnection();
  worker = new Worker<IngestionJobData>(QUEUE_NAME, processIngestion, {
    connection: workerConnection,
    concurrency: env.INGEST_CONCURRENCY,
  });

  worker.on('completed', (job) =>
    logger.info('Ingestion job completed', { sourceId: job.data.sourceId, jobId: job.id }),
  );
  worker.on('failed', (job, error) => {
    logger.error('Ingestion job failed', {
      sourceId: job?.data.sourceId,
      jobId: job?.id,
      attempts: job?.attemptsMade,
      error: error.message,
    });
    // Only once the retries are spent, so a source that recovers on its second
    // attempt is never briefly shown as failed. A batch that gives up marks the
    // source itself (see `queue/embedding.ts`), since it fails this job from
    // the embedding worker without the processor running again.
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      failIngestion(job.data.sourceId);
    }
  });
  worker.on('error', (error) => logger.error('Ingestion worker error', { error: error.message }));

  logger.info('Ingestion worker started', { concurrency: env.INGEST_CONCURRENCY });
  return worker;
}

/** Closes the worker and queue (and their Redis connections) for graceful shutdown. */
export async function closeIngestion(): Promise<void> {
  await worker?.close();
  await queue?.close();
  workerConnection?.disconnect();
  queueConnection?.disconnect();
  worker = null;
  queue = null;
  workerConnection = null;
  queueConnection = null;
}
