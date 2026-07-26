import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiFailure } from '@personallm/shared';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`Cannot ${req.method} ${req.path}`));
};

/**
 * Terminal error middleware. Only ApiError details reach the client; anything
 * else is logged with its stack and reported as a generic 500 so internals
 * (SQL text, file paths) never leak.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const apiError = err instanceof ApiError ? err : null;

  if (!apiError) {
    logger.error('Unhandled error', {
      method: req.method,
      path: req.path,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  } else if (apiError.status >= 500) {
    logger.error(apiError.message, { method: req.method, path: req.path });
  }

  const status = apiError?.status ?? 500;
  const payload: ApiFailure = {
    error: {
      message: apiError?.message ?? 'Something went wrong',
      code: apiError?.code ?? 'INTERNAL_ERROR',
      ...(apiError?.fields ? { fields: apiError.fields } : {}),
    },
  };

  // If a response already started streaming, headers are gone — just cut it off.
  if (res.headersSent) {
    res.end();
    return;
  }

  if (!env.isProduction && !apiError && err instanceof Error) {
    Object.assign(payload.error, { debug: err.message });
  }

  res.status(status).json(payload);
};
