import { Router } from 'express';
import { createNotebookSchema, updateNotebookSchema } from '@personallm/shared';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import {
  create,
  list,
  notebookIdParamSchema,
  read,
  remove,
  update,
} from './notebooks.controller.js';

export const notebooksRouter: Router = Router();

notebooksRouter.use(requireAuth);

notebooksRouter.get('/', list);
notebooksRouter.post('/', validate({ body: createNotebookSchema }), create);

notebooksRouter.get('/:id', validate({ params: notebookIdParamSchema }), read);
notebooksRouter.patch(
  '/:id',
  validate({ params: notebookIdParamSchema, body: updateNotebookSchema }),
  update,
);
// Cascades: the notebook's sources, their uploaded files and their vectors all
// go with it.
notebooksRouter.delete('/:id', validate({ params: notebookIdParamSchema }), remove);
