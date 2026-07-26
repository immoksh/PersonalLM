import type { Request, Response } from 'express';
import { googleSignInSchema } from '@personallm/shared';
import type { ApiSuccess, AuthResponse } from '@personallm/shared';
import { body } from '../../middleware/validate.js';
import { currentUser } from '../../middleware/requireAuth.js';
import { clearAuthCookie, setAuthCookie, signToken } from '../../utils/token.js';
import { verifyGoogleCredential } from '../../utils/googleAuth.js';
import { upsertGoogleUser } from './auth.service.js';

export async function signInWithGoogle(req: Request, res: Response): Promise<void> {
  const { credential } = body(req, googleSignInSchema);

  const identity = await verifyGoogleCredential(credential);
  const user = upsertGoogleUser(identity);

  // The Google token is not reused as the session; we mint our own so session
  // lifetime and revocation stay under this application's control.
  setAuthCookie(res, signToken({ sub: user.id }));

  const payload: ApiSuccess<AuthResponse> = { data: { user } };
  res.json(payload);
}

export function logout(_req: Request, res: Response): void {
  clearAuthCookie(res);
  res.status(204).end();
}

export function me(req: Request, res: Response): void {
  const payload: ApiSuccess<AuthResponse> = { data: { user: currentUser(req) } };
  res.json(payload);
}
