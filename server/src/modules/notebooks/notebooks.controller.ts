import type { Request, Response } from 'express';
import { z } from 'zod';
import { createNotebookSchema, updateNotebookSchema } from '@personallm/shared';
import type { ApiSuccess, Notebook } from '@personallm/shared';
import { body, params } from '../../middleware/validate.js';
import { currentUser } from '../../middleware/requireAuth.js';
import * as notebooksService from './notebooks.service.js';

export const notebookIdParamSchema = z.object({ id: z.string().uuid('Invalid notebook id') });

export function list(req: Request, res: Response): void {
  const user = currentUser(req);

  const payload: ApiSuccess<Notebook[]> = { data: notebooksService.listNotebooks(user.id) };
  res.json(payload);
}

export function read(req: Request, res: Response): void {
  const user = currentUser(req);
  const notebook = notebooksService.assertOwned(params(req, notebookIdParamSchema).id, user.id);

  const payload: ApiSuccess<Notebook> = { data: notebook };
  res.json(payload);
}

export function create(req: Request, res: Response): void {
  const user = currentUser(req);
  const notebook = notebooksService.createNotebook(user.id, body(req, createNotebookSchema));

  const payload: ApiSuccess<Notebook> = { data: notebook };
  res.status(201).json(payload);
}

export function update(req: Request, res: Response): void {
  const user = currentUser(req);
  const notebook = notebooksService.updateNotebook(
    params(req, notebookIdParamSchema).id,
    user.id,
    body(req, updateNotebookSchema),
  );

  const payload: ApiSuccess<Notebook> = { data: notebook };
  res.json(payload);
}

export function remove(req: Request, res: Response): void {
  const user = currentUser(req);
  notebooksService.deleteNotebook(params(req, notebookIdParamSchema).id, user.id);
  res.status(204).end();
}
