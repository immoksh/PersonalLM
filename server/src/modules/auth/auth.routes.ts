import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { googleSignInSchema } from '@personallm/shared';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { env } from '../../config/env.js';
import { logout, me, signInWithGoogle } from './auth.controller.js';

/** Token verification hits Google's servers, so cap how often it can be driven. */
const signInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isProduction ? 30 : 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts, please try again later', code: 'RATE_LIMITED' } },
});

export const authRouter: Router = Router();

authRouter.post('/google', signInLimiter, validate({ body: googleSignInSchema }), signInWithGoogle);
authRouter.post('/logout', logout);
authRouter.get('/me', requireAuth, me);
