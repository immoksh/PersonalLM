import type { ExtractedContent } from './parsers/types.js';

/**
 * One segment's footprint in the flattened document text.
 *
 * `start`/`end` are offsets into `ExtractedDocument.text`, which is the exact
 * string stored on the source row — so a chunk's offsets, a span's offsets and
 * what the viewer highlights all address the same characters. Anything that
 * re-normalises the text later would break that alignment, which is why
 * flattening happens once, here.
 */
export interface DocumentSpan {
  start: number;
  end: number;
  page?: number;
  startSec?: number;
  endSec?: number;
}

export interface ExtractedDocument {
  /** The canonical plain text: what gets indexed, stored, and highlighted. */
  text: string;
  /** Where each located segment ended up, in ascending order. */
  spans: DocumentSpan[];
  pageCount: number | null;
}

/** Segments are joined with a blank line, so neighbours never run together. */
const SEPARATOR = '\n\n';

/**
 * Normalises text the way chunking expects to receive it: horizontal whitespace
 * collapsed to single spaces, but newlines kept so paragraph boundaries survive
 * as candidate cut points.
 */
function normalize(text: string): string {
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Flattens extracted segments into one document, recording where each landed.
 *
 * Segments that normalise to nothing are dropped rather than given a zero-width
 * span: an empty span can never overlap a chunk, so it would only be dead
 * weight in the lookup.
 */
export function buildDocument(content: ExtractedContent): ExtractedDocument {
  const spans: DocumentSpan[] = [];
  const parts: string[] = [];
  let offset = 0;

  for (const segment of content.segments) {
    const text = normalize(segment.text);
    if (!text) continue;

    if (parts.length > 0) offset += SEPARATOR.length;
    const { text: _ignored, ...locator } = segment;
    spans.push({ ...locator, start: offset, end: offset + text.length });

    parts.push(text);
    offset += text.length;
  }

  return {
    text: parts.join(SEPARATOR),
    spans,
    pageCount: content.pageCount ?? null,
  };
}
