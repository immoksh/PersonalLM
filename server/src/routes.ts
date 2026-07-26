import { Router } from 'express';
import type { ApiSuccess } from '@personallm/shared';
import { authRouter } from './modules/auth/auth.routes.js';
import { notebooksRouter } from './modules/notebooks/notebooks.routes.js';
import { sourcesRouter } from './modules/sources/sources.routes.js';
import { chatRouter } from './modules/chat/chat.routes.js';

export const apiRouter: Router = Router();

apiRouter.get('/health', (_req, res) => {
  const payload: ApiSuccess<{ status: 'ok'; uptime: number; timestamp: string }> = {
    data: {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  };
  res.json(payload);
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/notebooks', notebooksRouter);
apiRouter.use('/sources', sourcesRouter);
apiRouter.use('/chat', chatRouter);
