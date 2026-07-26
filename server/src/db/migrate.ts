/**
 * Standalone migration runner: `npm run db:migrate`.
 *
 * Importing the connection applies anything pending, so this script exists to
 * do that without starting the HTTP server (deploy steps, CI, fresh checkouts).
 */
import { closeDatabase } from './index.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

logger.info('Migrations up to date', { database: env.databasePath });
closeDatabase();
