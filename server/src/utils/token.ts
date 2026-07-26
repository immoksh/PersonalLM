import jwt from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';

export const AUTH_COOKIE = 'personallm_token';

export interface TokenPayload {
  /** User id. */
  sub: string;
}

/** `expiresIn` is typed against the `ms` string-literal union; ours comes from env. */
type ExpiresIn = jwt.SignOptions['expiresIn'];

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as ExpiresIn,
  });
}

export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string') {
      throw ApiError.unauthorized('Malformed session token');
    }
    return { sub: decoded.sub };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Your session has expired, please sign in again');
    }
    throw ApiError.unauthorized('Invalid session token');
  }
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true, // Not readable from JS, so XSS cannot exfiltrate the session.
    sameSite: 'lax', // Blocks the cross-site POSTs that CSRF relies on.
    secure: env.isProduction, // HTTPS-only in production; plain HTTP in local dev.
    path: '/',
  };
}

/** Issues the session cookie, expiring it exactly when the token itself expires. */
export function setAuthCookie(res: Response, token: string): void {
  const decoded = jwt.decode(token);
  const expSeconds = typeof decoded === 'object' && decoded !== null ? decoded.exp : undefined;
  const maxAge = expSeconds ? expSeconds * 1000 - Date.now() : undefined;

  res.cookie(AUTH_COOKIE, token, {
    ...cookieOptions(),
    ...(maxAge && maxAge > 0 ? { maxAge } : {}),
  });
}

export function clearAuthCookie(res: Response): void {
  // Options must match the ones used to set it or the browser keeps the cookie.
  res.clearCookie(AUTH_COOKIE, cookieOptions());
}
