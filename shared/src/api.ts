/**
 * The wire format every endpoint uses. Keeping it in one place means the client
 * can unwrap responses generically instead of guessing per-endpoint shapes.
 */

/** Machine-readable error codes. The client switches on these, never on messages. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Field-level validation problems, keyed by dotted path (e.g. `title`). */
export type FieldErrors = Record<string, string[]>;

export interface ApiErrorBody {
  message: string;
  code: ErrorCode;
  /** Present only for VALIDATION_ERROR. */
  fields?: FieldErrors;
}

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiFailure {
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function isApiFailure<T>(body: ApiResponse<T>): body is ApiFailure {
  return typeof body === 'object' && body !== null && 'error' in body;
}
