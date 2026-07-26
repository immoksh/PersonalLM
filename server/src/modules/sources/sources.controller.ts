import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createTextSourceSchema,
  createWebsiteSourceSchema,
  createYouTubeSourceSchema,
  listSourcesQuerySchema,
  FILE_SOURCE_KINDS,
} from '@personallm/shared';
import type { ApiSuccess, Source } from '@personallm/shared';
import { body, params, query } from '../../middleware/validate.js';
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

export function createFiles(req: Request, res: Response): void {
  const user = currentUser(req);
  const { kind } = params(req, fileKindParamSchema);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  if (files.length === 0) {
    throw ApiError.badRequest('Attach at least one file');
  }

  try {
    const sources = sourcesService.createFileSources(user.id, kind, files);
    const payload: ApiSuccess<Source[]> = { data: sources };
    res.status(201).json(payload);
  } catch (error) {
    // The rows were rolled back, so the bytes on disk are now unreferenced.
    discardUploads(files);
    throw error;
  }
}

export function remove(req: Request, res: Response): void {
  const user = currentUser(req);
  sourcesService.deleteSource(params(req, sourceIdParamSchema).id, user.id);
  res.status(204).end();
}
