import path from 'node:path';
import fs from 'node:fs';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env, ROOT_DIR } from './config/env.js';
import { apiRouter } from './routes.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function createApp(): Express {
  const app = express();

  // Behind a proxy/load balancer, trust its X-Forwarded-* headers so rate
  // limiting and `secure` cookies see the real client protocol and IP.
  if (env.isProduction) app.set('trust proxy', 1);

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true, // Required for the browser to send the auth cookie.
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  if (!env.isTest) {
    app.use(morgan(env.isProduction ? 'combined' : 'dev'));
  }

  // Coarse ceiling for the whole API; per-route limits handle the sensitive ones.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: env.isProduction ? 120 : 10_000,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  app.use('/api', apiRouter);

  // In production the API also serves the built client, so one process and one
  // origin covers both — which is why no CORS preflight is needed there.
  const clientDist = path.resolve(ROOT_DIR, 'client/dist');
  if (env.isProduction && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    // Any non-API path falls through to the SPA so client-side routes deep-link.
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
