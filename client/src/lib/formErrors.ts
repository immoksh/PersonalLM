import { z } from 'zod';
import type { FieldErrors } from '@personallm/shared';
import { ApiClientError } from './api';

/** Flattens a Zod failure into the same shape the API returns for 400s. */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

/**
 * Splits a thrown error into per-field messages and a form-level message, so a
 * server-side validation failure renders identically to a client-side one.
 */
export function toFormErrors(error: unknown): { fields: FieldErrors; message: string | null } {
  if (error instanceof z.ZodError) {
    return { fields: zodFieldErrors(error), message: null };
  }
  if (error instanceof ApiClientError) {
    return { fields: error.fields ?? {}, message: error.fields ? null : error.message };
  }
  return { fields: {}, message: error instanceof Error ? error.message : 'Something went wrong' };
}

export const firstError = (fields: FieldErrors, key: string): string | undefined =>
  fields[key]?.[0];
