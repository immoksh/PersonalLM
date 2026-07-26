import type { Request, RequestHandler } from 'express';
import type { PublicUser } from '@personallm/shared';
import { ApiError } from '../utils/ApiError.js';
import { AUTH_COOKIE, verifyToken } from '../utils/token.js';
import { findUserById } from '../modules/auth/auth.service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth`; use `currentUser(req)` to read it. */
      user?: PublicUser;
    }
  }
}

/**
 * Rejects the request unless it carries a valid session cookie for a user that
 * still exists — a deleted account's unexpired token must not keep working.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[AUTH_COOKIE] as string | undefined;
  if (!token) {
    next(ApiError.unauthorized('You must be signed in to do that'));
    return;
  }

  try {
    const { sub } = verifyToken(token);
    const user = findUserById(sub);
    if (!user) {
      next(ApiError.unauthorized('Your account no longer exists'));
      return;
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

/** Reads the authenticated user; only valid downstream of `requireAuth`. */
export function currentUser(req: Request): PublicUser {
  if (!req.user) {
    throw ApiError.internal('Route is missing requireAuth middleware');
  }
  return req.user;
}
