import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { chatRequestSchema } from '@personallm/shared';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { env } from '../../config/env.js';
import { ask, askStream } from './chat.controller.js';

/** Every question calls the embedding + chat APIs, so cap the spend per user. */
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.isProduction ? 20 : 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { message: 'Too many questions, please slow down', code: 'RATE_LIMITED' } },
});

export const chatRouter: Router = Router();

chatRouter.use(requireAuth);
chatRouter.post('/', chatLimiter, validate({ body: chatRequestSchema }), ask);
// POST rather than GET (so EventSource is out) because the question travels in
// the body; the client reads the SSE stream off fetch() instead.
chatRouter.post('/stream', chatLimiter, validate({ body: chatRequestSchema }), askStream);
