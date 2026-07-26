import { Router } from 'express';
import {
  createTextSourceSchema,
  createWebsiteSourceSchema,
  createYouTubeSourceSchema,
  listSourcesQuerySchema,
} from '@personallm/shared';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { uploadFiles } from '../../middleware/upload.js';
import {
  createFiles,
  createText,
  createWebsite,
  createYouTube,
  fileKindParamSchema,
  list,
  remove,
  sourceIdParamSchema,
} from './sources.controller.js';

export const sourcesRouter: Router = Router();

sourcesRouter.use(requireAuth);

sourcesRouter.get('/', validate({ query: listSourcesQuerySchema }), list);

sourcesRouter.post('/text', validate({ body: createTextSourceSchema }), createText);
sourcesRouter.post('/website', validate({ body: createWebsiteSourceSchema }), createWebsite);
sourcesRouter.post('/youtube', validate({ body: createYouTubeSourceSchema }), createYouTube);

// `kind` comes from the path so multer's file filter never has to depend on
// multipart field ordering to know what it is validating against.
sourcesRouter.post(
  '/files/:kind',
  validate({ params: fileKindParamSchema }),
  uploadFiles('files'),
  createFiles,
);

sourcesRouter.delete('/:id', validate({ params: sourceIdParamSchema }), remove);
