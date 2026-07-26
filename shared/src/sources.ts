import { z } from 'zod';

export const SOURCE_KINDS = ['pdf', 'text', 'website', 'youtube', 'transcript'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Kinds that arrive as uploaded files rather than typed input. */
export const FILE_SOURCE_KINDS = ['pdf', 'transcript'] as const;
export type FileSourceKind = (typeof FILE_SOURCE_KINDS)[number];

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 100_000;
export const MAX_TITLE_LENGTH = 160;

/** Accepted extensions per file kind. Extension is the check that actually
 *  holds: browsers report inconsistent MIME types for .vtt and .srt.
 *  `maxFiles` is per-kind: a PDF must be uploaded one at a time, while
 *  transcript files may be batched. */
export const FILE_ACCEPT: Record<
  FileSourceKind,
  { extensions: string[]; mimeTypes: string[]; maxFiles: number }
> = {
  pdf: { extensions: ['.pdf'], mimeTypes: ['application/pdf'], maxFiles: 1 },
  transcript: {
    extensions: ['.vtt', '.srt', '.txt'],
    mimeTypes: ['text/vtt', 'text/plain', 'application/x-subrip'],
    maxFiles: 10,
  },
};

/** How many files may be sent in a single upload of the given kind. */
export const maxFilesForKind = (kind: FileSourceKind): number => FILE_ACCEPT[kind].maxFiles;

/** Overall ceiling across kinds — the multer instance sizes its buffers to this. */
export const MAX_FILES_PER_UPLOAD = Math.max(
  ...Object.values(FILE_ACCEPT).map((accept) => accept.maxFiles),
);

export const isFileSourceKind = (kind: SourceKind): kind is FileSourceKind =>
  (FILE_SOURCE_KINDS as readonly string[]).includes(kind);

/** `accept` attribute for a file input of the given kind. */
export const acceptAttribute = (kind: FileSourceKind): string =>
  [...FILE_ACCEPT[kind].extensions, ...FILE_ACCEPT[kind].mimeTypes].join(',');

export function hasAllowedExtension(fileName: string, kind: FileSourceKind): boolean {
  const lower = fileName.toLowerCase();
  return FILE_ACCEPT[kind].extensions.some((extension) => lower.endsWith(extension));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- URL handling --------------------------------------------------------

const httpUrlSchema = z
  .string()
  .trim()
  .min(1, 'Enter a URL')
  .transform((value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`))
  .refine((value) => {
    try {
      const { protocol, hostname } = new URL(value);
      return (protocol === 'http:' || protocol === 'https:') && hostname.includes('.');
    } catch {
      return false;
    }
  }, 'Enter a valid URL, for example https://example.com/article');

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

/** Returns the 11-character video id, or null if this is not a YouTube video URL. */
export function parseYouTubeId(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return null;
  }

  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;

  const isValid = (id: string | undefined | null): id is string =>
    Boolean(id) && /^[\w-]{11}$/.test(id as string);

  // youtu.be/<id> and /shorts/<id>, /embed/<id>, /live/<id> put it in the path.
  if (url.hostname.endsWith('youtu.be')) {
    const id = url.pathname.slice(1).split('/')[0];
    return isValid(id) ? id : null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] && ['shorts', 'embed', 'live', 'v'].includes(segments[0])) {
    return isValid(segments[1]) ? segments[1] : null;
  }

  return isValid(url.searchParams.get('v')) ? url.searchParams.get('v') : null;
}

export const youTubeThumbnail = (videoId: string): string =>
  `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

// --- Payload schemas -----------------------------------------------------

const titleSchema = z
  .string()
  .trim()
  .max(MAX_TITLE_LENGTH, `Title must be at most ${MAX_TITLE_LENGTH} characters`);

export const createTextSourceSchema = z.object({
  title: titleSchema.min(1, 'Give this source a title'),
  /** Rich-text HTML produced by the editor. */
  content: z
    .string()
    .min(1, 'Add some content')
    .max(MAX_TEXT_LENGTH, `Content must be at most ${MAX_TEXT_LENGTH.toLocaleString()} characters`),
  /** Tag-stripped copy, used for previews and search. */
  plainText: z.string().max(MAX_TEXT_LENGTH).default(''),
});

export const createWebsiteSourceSchema = z.object({
  title: titleSchema.optional(),
  url: httpUrlSchema,
});

export const createYouTubeSourceSchema = z.object({
  title: titleSchema.optional(),
  url: z
    .string()
    .trim()
    .min(1, 'Enter a YouTube URL')
    .refine((value) => parseYouTubeId(value) !== null, 'That is not a valid YouTube video URL'),
});

export const listSourcesQuerySchema = z.object({
  kind: z.enum(SOURCE_KINDS).optional(),
  q: z.string().trim().max(120).optional(),
});

export type CreateTextSourceInput = z.infer<typeof createTextSourceSchema>;
export type CreateWebsiteSourceInput = z.infer<typeof createWebsiteSourceSchema>;
export type CreateYouTubeSourceInput = z.infer<typeof createYouTubeSourceSchema>;
export type ListSourcesQuery = z.infer<typeof listSourcesQuerySchema>;

export type SourceStatus = 'ready' | 'processing' | 'failed';

export interface Source {
  id: string;
  userId: string;
  kind: SourceKind;
  title: string;
  /** Website / YouTube sources only. */
  url: string | null;
  /** YouTube sources only. */
  videoId: string | null;
  /** Short plain-text preview, safe to render as text. */
  preview: string | null;
  /** Uploaded-file sources only. */
  fileName: string | null;
  fileSize: number | null;
  status: SourceStatus;
  createdAt: string;
}

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  pdf: 'PDF',
  text: 'Plain Text',
  website: 'Website URL',
  youtube: 'YouTube Video',
  transcript: 'VTT / Transcript',
};
