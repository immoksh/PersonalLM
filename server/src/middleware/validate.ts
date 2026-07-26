import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import type { FieldErrors } from '@personallm/shared';
import { ApiError } from '../utils/ApiError.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Output of `validate()`. Populated per-request; read it with the typed
       * `body()` / `query()` / `params()` accessors rather than directly.
       *
       * Express 5 exposes `req.query` through a getter-only property, so parsed
       * values are stored here instead of written back onto the request.
       */
      valid?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

interface Schemas {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
}

function toFieldErrors(error: z.ZodError, prefix: string): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : prefix;
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

/**
 * Validates and coerces the named request parts, rejecting with a 400 that
 * lists every offending field at once rather than failing on the first.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const valid: NonNullable<Request['valid']> = {};
    const fields: FieldErrors = {};

    for (const part of ['body', 'query', 'params'] as const) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (result.success) {
        valid[part] = result.data;
      } else {
        Object.assign(fields, toFieldErrors(result.error, part));
      }
    }

    if (Object.keys(fields).length > 0) {
      next(ApiError.badRequest('The submitted data is invalid', fields));
      return;
    }

    req.valid = valid;
    next();
  };
}

/**
 * Validates the body from inside a handler, for multipart routes where there is
 * no body yet when `validate()` runs — multer parses it afterwards. Rejects with
 * the same 400 shape as `validate()`.
 */
export function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw ApiError.badRequest('The submitted data is invalid', toFieldErrors(result.error, 'body'));
  }
  return result.data;
}

/**
 * Typed readers for validated data. The schema argument is used only to infer
 * the result type — pass the same schema the route validated with.
 */
function reader(part: 'body' | 'query' | 'params') {
  return <S extends z.ZodTypeAny>(req: Request, _schema: S): z.infer<S> => {
    const value = req.valid?.[part];
    if (value === undefined) {
      // Reaching here means the route forgot its validate() middleware.
      throw ApiError.internal(`Route is missing validate() for request ${part}`);
    }
    return value as z.infer<S>;
  };
}

export const body = reader('body');
export const query = reader('query');
export const params = reader('params');
