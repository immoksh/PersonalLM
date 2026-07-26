import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import type { RequestHandler } from 'express';
import {
  FILE_ACCEPT,
  MAX_FILE_BYTES,
  MAX_FILES_PER_UPLOAD,
  formatBytes,
  hasAllowedExtension,
  isFileSourceKind,
  maxFilesForKind,
  type FileSourceKind,
} from '@personallm/shared';
import { env, ROOT_DIR } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

export const UPLOAD_DIR = path.resolve(ROOT_DIR, env.UPLOAD_DIR);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Never reuse the client's filename on disk: it can contain traversal
    // sequences or collide. The original is kept in the database instead.
    const extension = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${randomUUID()}${extension}`);
  },
});

/** Reads the upload kind from the route, so it cannot depend on multipart field order. */
const kindFromRequest = (params: Record<string, string>): FileSourceKind | null => {
  const kind = params.kind;
  return kind && isFileSourceKind(kind as never) ? (kind as FileSourceKind) : null;
};

const uploader = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_UPLOAD },
  fileFilter: (req, file, cb) => {
    const kind = kindFromRequest(req.params as Record<string, string>);
    if (!kind) {
      cb(new ApiError(400, 'VALIDATION_ERROR', 'Unsupported upload type'));
      return;
    }
    if (!hasAllowedExtension(file.originalname, kind)) {
      const allowed = FILE_ACCEPT[kind].extensions.join(', ');
      cb(ApiError.badRequest(`“${file.originalname}” is not accepted. Allowed: ${allowed}`));
      return;
    }
    cb(null, true);
  },
});

/** Best-effort cleanup — a rejected request should not leave orphaned bytes. */
export function discardUploads(files: Express.Multer.File[] | undefined): void {
  for (const file of files ?? []) {
    fs.rm(file.path, { force: true }, () => {});
  }
}

/** Human-readable ceiling for a kind, e.g. "one PDF" or "at most 10 files". */
const tooManyMessage = (maxFiles: number): string =>
  maxFiles === 1 ? 'Upload one file at a time' : `Upload at most ${maxFiles} files at a time`;

/**
 * Wraps `multer.array` so its own error codes surface as normal API errors
 * instead of falling through to the generic 500 handler. The file-count limit
 * is per-kind (read from the `:kind` route param), so a PDF is capped at one
 * file while transcripts may be batched.
 */
export function uploadFiles(fieldName: string): RequestHandler {
  return (req, res, next) => {
    const kind = kindFromRequest(req.params as Record<string, string>);
    if (!kind) {
      next(ApiError.badRequest('Unsupported upload type'));
      return;
    }

    const maxFiles = maxFilesForKind(kind);
    const handler = uploader.array(fieldName, maxFiles);

    handler(req, res, (error: unknown) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError) {
        discardUploads(req.files as Express.Multer.File[] | undefined);
        switch (error.code) {
          case 'LIMIT_FILE_SIZE':
            next(ApiError.badRequest(`Each file must be ${formatBytes(MAX_FILE_BYTES)} or smaller`));
            return;
          case 'LIMIT_FILE_COUNT':
            next(ApiError.badRequest(tooManyMessage(maxFiles)));
            return;
          case 'LIMIT_UNEXPECTED_FILE':
            // Multer reports the over-the-limit file under the expected field
            // name too, so distinguish "too many" from a genuinely wrong field.
            next(
              ApiError.badRequest(
                error.field === fieldName
                  ? tooManyMessage(maxFiles)
                  : `Unexpected file field “${error.field ?? fieldName}”`,
              ),
            );
            return;
          default:
            next(ApiError.badRequest(error.message));
            return;
        }
      }

      next(error);
    });
  };
}
