import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDatabase } from './db/index.js';
import { closeQueues, startWorkers } from './queue/index.js';
import { logger } from './utils/logger.js';

// Importing the app opens the database, which runs pending migrations.
const server = createApp().listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}`, { env: env.NODE_ENV });
});

// Run the ingestion workers in-process by default so `npm run dev` just works.
// Set INGEST_INLINE_WORKER=false to run workers separately (npm run start:worker).
if (env.INGEST_INLINE_WORKER) startWorkers();

/** Finish in-flight requests, then release the DB handle. */
function shutdown(signal: string): void {
  logger.info(`Received ${signal}, shutting down`);
  server.close(() => {
    // Drain the workers and release Redis before closing the DB they write to.
    void closeQueues().finally(() => {
      closeDatabase();
      process.exit(0);
    });
  });
  // Don't hang forever on a wedged connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
