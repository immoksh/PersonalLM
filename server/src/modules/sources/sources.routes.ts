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
  read,
  readFile,
  reindex,
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

// The source viewer's two reads: the extracted text a citation's offsets point
// into, and the original bytes behind an upload.
sourcesRouter.get('/:id', validate({ params: sourceIdParamSchema }), read);
sourcesRouter.get('/:id/file', validate({ params: sourceIdParamSchema }), readFile);

// POST rather than PUT: re-indexing is an action with side effects, not an
// idempotent replacement of the source.
sourcesRouter.post('/:id/reindex', validate({ params: sourceIdParamSchema }), reindex);

sourcesRouter.delete('/:id', validate({ params: sourceIdParamSchema }), remove);
