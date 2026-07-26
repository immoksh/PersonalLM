import { isApiFailure } from '@personallm/shared';
import type {
  ApiResponse,
  AuthResponse,
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  CreateTextSourceInput,
  CreateWebsiteSourceInput,
  CreateYouTubeSourceInput,
  ErrorCode,
  FieldErrors,
  FileSourceKind,
  ListSourcesQuery,
  Source,
} from '@personallm/shared';
import { parseEventStream } from './sse';

/** Same-origin by default; the Vite proxy forwards `/api` to Express in dev. */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

/** A structured failure from the API, carrying the server's code and field errors. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: FieldErrors | undefined;

  constructor(status: number, code: ErrorCode, message: string, fields?: FieldErrors) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  get isUnauthorized(): boolean {
    return this.code === 'UNAUTHORIZED';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: 'include', // Send the httpOnly auth cookie.
      headers: {
        // FormData must set its own Content-Type — it carries the multipart
        // boundary, and overriding it makes the body unparseable server-side.
        ...(init.body && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...init.headers,
      },
    });
  } catch {
    // fetch only rejects on network/CORS failure, never on a 4xx/5xx.
    throw new ApiClientError(0, 'INTERNAL_ERROR', 'Cannot reach the server. Is it running?');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError(
      response.status,
      'INTERNAL_ERROR',
      `Unexpected non-JSON response (HTTP ${response.status})`,
    );
  }

  if (!response.ok || isApiFailure(payload)) {
    const error = isApiFailure(payload)
      ? payload.error
      : { message: `Request failed (HTTP ${response.status})`, code: 'INTERNAL_ERROR' as const };
    throw new ApiClientError(
      response.status,
      error.code,
      error.message,
      'fields' in error ? error.fields : undefined,
    );
  }

  return payload.data;
}

/** Builds the error for a response already known to have failed. */
async function toApiError(response: Response): Promise<ApiClientError> {
  let payload: ApiResponse<unknown> | null = null;
  try {
    payload = (await response.json()) as ApiResponse<unknown>;
  } catch {
    return new ApiClientError(
      response.status,
      'INTERNAL_ERROR',
      `Unexpected non-JSON response (HTTP ${response.status})`,
    );
  }

  if (payload && isApiFailure(payload)) {
    const { message, code } = payload.error;
    return new ApiClientError(
      response.status,
      code,
      message,
      'fields' in payload.error ? payload.error.fields : undefined,
    );
  }
  return new ApiClientError(
    response.status,
    'INTERNAL_ERROR',
    `Request failed (HTTP ${response.status})`,
  );
}

/**
 * POSTs `payload` and yields the server-sent events it streams back.
 *
 * Aborting via `signal` ends the loop quietly — a caller that cancelled is not
 * interested in an error. Anything else surfaces as an `ApiClientError`, the
 * same as a plain request.
 */
async function* streamRequest<T>(
  path: string,
  payload: unknown,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (isAbort(error)) return;
    throw new ApiClientError(0, 'INTERNAL_ERROR', 'Cannot reach the server. Is it running?');
  }

  // A failure before the stream opens is still a normal JSON error response.
  if (!response.ok || !response.body) throw await toApiError(response);

  try {
    yield* parseEventStream<T>(response.body);
  } catch (error) {
    if (!isAbort(error)) throw error;
  }
}

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

const body = (value: unknown): string => JSON.stringify(value);

export const api = {
  auth: {
    /** Exchanges a Google ID token for this app's own session cookie. */
    google: (credential: string) =>
      request<AuthResponse>('/auth/google', { method: 'POST', body: body({ credential }) }),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
    me: () => request<AuthResponse>('/auth/me'),
  },
  sources: {
    list: (params: ListSourcesQuery = {}) => {
      const search = new URLSearchParams();
      if (params.kind) search.set('kind', params.kind);
      if (params.q) search.set('q', params.q);
      const qs = search.toString();
      return request<Source[]>(`/sources${qs ? `?${qs}` : ''}`);
    },
    createText: (input: CreateTextSourceInput) =>
      request<Source>('/sources/text', { method: 'POST', body: body(input) }),
    createWebsite: (input: CreateWebsiteSourceInput) =>
      request<Source>('/sources/website', { method: 'POST', body: body(input) }),
    createYouTube: (input: CreateYouTubeSourceInput) =>
      request<Source>('/sources/youtube', { method: 'POST', body: body(input) }),
    /** Uploads every file in one multipart request; returns one Source each. */
    createFiles: (kind: FileSourceKind, files: File[]) => {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      return request<Source[]>(`/sources/files/${kind}`, { method: 'POST', body: form });
    },
    remove: (id: string) => request<void>(`/sources/${id}`, { method: 'DELETE' }),
  },
  chat: {
    /** Asks one grounded question; retrieval is server-side over the user's sources. */
    ask: (input: ChatRequest) =>
      request<ChatResponse>('/chat', { method: 'POST', body: body(input) }),
    /** The same question, answered as a stream of citations then answer tokens. */
    askStream: (input: ChatRequest, signal?: AbortSignal) =>
      streamRequest<ChatStreamEvent>('/chat/stream', input, signal),
  },
};
