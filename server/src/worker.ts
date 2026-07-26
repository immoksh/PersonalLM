import { env } from './config/env.js';
import { closeDatabase } from './db/index.js';
import { closeQueues, startWorkers } from './queue/index.js';
import { logger } from './utils/logger.js';

/**
 * Standalone ingestion worker process, running both queue stages (source
 * extraction and chunk embedding). Run this as its own process to scale
 * ingestion independently of the API (set INGEST_INLINE_WORKER=false on the API
 * so it doesn't also process jobs). Importing the db module runs pending
 * migrations.
 */
if (!startWorkers()) {
  logger.error('Worker process exiting: RAG is disabled (set OPENAI_API_KEY)');
  process.exit(1);
}

logger.info('Ingestion worker process ready', { env: env.NODE_ENV });

function shutdown(signal: string): void {
  logger.info(`Received ${signal}, shutting down worker`);
  void closeQueues().finally(() => {
    closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
