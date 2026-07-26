import type { SourceKind } from '@personallm/shared';

/** The subset of a source row every parser reads from. */
export interface ExtractableSource {
  id: string;
  kind: SourceKind;
  title: string;
  url: string | null;
  video_id: string | null;
  content: string | null;
  file_path: string | null;
}

/**
 * A run of text that shares one position in the original artefact: a PDF page,
 * a caption cue, a paragraph.
 *
 * Parsers return these rather than one flat string so the position survives
 * into the index. Chunking happens *after* the segments are concatenated, so a
 * chunk may span several of them — the chunker then reports the range it
 * covered, which is what lets a citation say "page 4" or "seek to 3:12".
 */
export interface ExtractedSegment {
  text: string;
  /** 1-based page number, for paginated formats. */
  page?: number;
  /** Seconds into the media, for timed formats. */
  startSec?: number;
  endSec?: number;
}

/** Everything one extraction produced, plus whatever the format knows about itself. */
export interface ExtractedContent {
  segments: ExtractedSegment[];
  /** Total pages, when the format is paginated. */
  pageCount?: number;
}

/** Wraps a plain string as the single untimed, unpaginated segment. */
export const asSingleSegment = (text: string): ExtractedContent => ({ segments: [{ text }] });

/** Thrown when a source yields no usable text; ingestion marks it `failed`. */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}
