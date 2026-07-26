import { closeEmbedding, startEmbeddingWorker } from './embedding.js';
import { closeIngestion, startIngestionWorker } from './ingestion.js';

export { scheduleIngestion } from './ingestion.js';

/**
 * Starts both ingestion workers: the per-source one (extract → chunk → fan out)
 * and the per-batch embedding one. They share a process here; scale them apart
 * by running more worker processes. Returns false when RAG is disabled and
 * neither worker started.
 */
export function startWorkers(): boolean {
  const ingestion = startIngestionWorker();
  const embedding = startEmbeddingWorker();
  return Boolean(ingestion && embedding);
}

/** Drains both workers and releases their Redis connections. */
export async function closeQueues(): Promise<void> {
  await Promise.all([closeIngestion(), closeEmbedding()]);
}
