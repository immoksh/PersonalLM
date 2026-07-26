import path from 'node:path';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createTextSourceSchema,
  createWebsiteSourceSchema,
  createYouTubeSourceSchema,
  listSourcesQuerySchema,
  notebookTargetSchema,
  FILE_SOURCE_KINDS,
} from '@personallm/shared';
import type { ApiSuccess, Source, SourceDetail } from '@personallm/shared';
import { body, params, parseBody, query } from '../../middleware/validate.js';
import { currentUser } from '../../middleware/requireAuth.js';
import { discardUploads } from '../../middleware/upload.js';
import { ApiError } from '../../utils/ApiError.js';
import * as sourcesService from './sources.service.js';

export const sourceIdParamSchema = z.object({ id: z.string().uuid('Invalid source id') });
export const fileKindParamSchema = z.object({ kind: z.enum(FILE_SOURCE_KINDS) });

export function list(req: Request, res: Response): void {
  const user = currentUser(req);
  const sources = sourcesService.listSources(user.id, query(req, listSourcesQuerySchema));

  const payload: ApiSuccess<Source[]> = { data: sources };
  res.json(payload);
}

export function createText(req: Request, res: Response): void {
  const user = currentUser(req);
  const source = sourcesService.createTextSource(user.id, body(req, createTextSourceSchema));

  const payload: ApiSuccess<Source> = { data: source };
  res.status(201).json(payload);
}

export function createWebsite(req: Request, res: Response): void {
  const user = currentUser(req);
  const source = sourcesService.createWebsiteSource(user.id, body(req, createWebsiteSourceSchema));

  const payload: ApiSuccess<Source> = { data: source };
  res.status(201).json(payload);
}

export function createYouTube(req: Request, res: Response): void {
  const user = currentUser(req);
  const source = sourcesService.createYouTubeSource(user.id, body(req, createYouTubeSourceSchema));

  const payload: ApiSuccess<Source> = { data: source };
  res.status(201).json(payload);
}

export function read(req: Request, res: Response): void {
  const user = currentUser(req);
  const source = sourcesService.getSourceDetail(params(req, sourceIdParamSchema).id, user.id);

  const payload: ApiSuccess<SourceDetail> = { data: source };
  res.json(payload);
}

/**
 * Streams the original upload back — what the viewer points its PDF frame at.
 *
 * `inline` so the browser renders it rather than downloading it, and the
 * filename is quoted through `path.basename` because it comes from whatever the
 * user named their file and would otherwise be free to inject header syntax.
 */
export function readFile(req: Request, res: Response): void {
  const user = currentUser(req);
  const file = sourcesService.getSourceFile(params(req, sourceIdParamSchema).id, user.id);

  const safeName = path.basename(file.fileName).replace(/["\\]/g, '');
  res.type(file.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  // Private: the response is one user's document behind a session cookie, and
  // must never be held in a shared cache.
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(file.path);
}

export function createFiles(req: Request, res: Response): void {
  const user = currentUser(req);
  const { kind } = params(req, fileKindParamSchema);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  if (files.length === 0) {
    throw ApiError.badRequest('Attach at least one file');
  }

  try {
    // Read inside the try: multer has already written the bytes by now, so a
    // missing or unowned notebook has to clean them up like any other failure.
    // Parsed here rather than by `validate({ body })`, which runs before multer
    // has parsed the multipart body at all.
    const { notebookId } = parseBody(req, notebookTargetSchema);
    const sources = sourcesService.createFileSources(user.id, notebookId, kind, files);
    const payload: ApiSuccess<Source[]> = { data: sources };
    res.status(201).json(payload);
  } catch (error) {
    // Nothing was committed, so the bytes on disk are now unreferenced.
    discardUploads(files);
    throw error;
  }
}

export function reindex(req: Request, res: Response): void {
  const user = currentUser(req);
  const source = sourcesService.reindexSource(params(req, sourceIdParamSchema).id, user.id);

  const payload: ApiSuccess<Source> = { data: source };
  res.json(payload);
}

export function remove(req: Request, res: Response): void {
  const user = currentUser(req);
  sourcesService.deleteSource(params(req, sourceIdParamSchema).id, user.id);
  res.status(204).end();
}
