import { config } from '../../config/rag.js';
import type { DocumentSpan, ExtractedDocument } from './document.js';

/** A chunk plus where it sits, both in the text and in the original artefact. */
export interface LocatedChunk {
  text: string;
  /** Offsets into the source's stored extracted text. */
  charStart: number;
  charEnd: number;
  /** 1-based page the chunk starts on — PDFs only. */
  page: number | null;
  /** Seconds spanned by the chunk — timed transcripts and video only. */
  startSec: number | null;
  endSec: number | null;
}

/** Half-open range of a chunk within the document text. */
interface Range {
  start: number;
  end: number;
}

/**
 * Splits already-normalised text into overlapping ranges (~chunkSize chars,
 * chunkOverlap overlap), breaking on whitespace boundaries where possible so
 * words stay intact.
 *
 * Ranges rather than strings, because the offsets are what let a citation point
 * back into the stored text. The input must be the exact string that gets
 * stored — normalising here instead would shift every offset by the whitespace
 * it collapsed. `buildDocument` does that normalising, once.
 */
export function chunkRanges(
  text: string,
  chunkSize: number = config.chunking.chunkSize,
  overlap: number = config.chunking.chunkOverlap,
): Range[] {
  if (!text) return [];
  if (text.length <= chunkSize) {
    const only = trimRange(text, 0, text.length);
    return only ? [only] : [];
  }

  const ranges: Range[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // Prefer to cut on the last whitespace inside the window, unless that would
    // shrink the chunk below half size (a very long unbroken token).
    if (end < text.length) {
      const boundary = lastWhitespace(text, start, end);
      if (boundary > start + chunkSize / 2) end = boundary;
    }

    const range = trimRange(text, start, end);
    if (range) ranges.push(range);

    if (end >= text.length) break;

    // Step forward keeping ~`overlap` chars of context, but snap that start to
    // the next word boundary so the following chunk also begins cleanly.
    let next = end - overlap;
    if (next > start) {
      const boundary = nextWhitespace(text, next, end);
      if (boundary !== -1) next = boundary + 1;
    }
    start = next > start ? next : end; // never stall
  }

  return ranges;
}

/**
 * Chunks a document and resolves each chunk's position in the original
 * artefact from the segments it overlaps.
 *
 * A chunk routinely straddles segment boundaries — a paragraph continuing onto
 * the next PDF page, a sentence spread over three caption cues. The convention
 * is to report where the chunk *starts* (the page you would turn to, the moment
 * you would seek to) and, for timed media, how far it runs.
 */
export function chunkDocument(
  document: ExtractedDocument,
  chunkSize?: number,
  overlap?: number,
): LocatedChunk[] {
  const ranges = chunkRanges(document.text, chunkSize, overlap);
  // Ranges come out in ascending order, so the scan for each chunk's first
  // overlapping span can resume where the previous one started rather than
  // re-walking the spans from the top: O(chunks + spans), not O(chunks × spans).
  let cursor = 0;

  return ranges.map((range) => {
    while (cursor < document.spans.length && document.spans[cursor]!.end <= range.start) {
      cursor += 1;
    }

    const covered: DocumentSpan[] = [];
    for (let i = cursor; i < document.spans.length; i += 1) {
      const span = document.spans[i]!;
      if (span.start >= range.end) break;
      covered.push(span);
    }

    const timed = covered.filter((span) => span.startSec !== undefined);
    const ends = covered
      .map((span) => span.endSec)
      .filter((value): value is number => value !== undefined);

    return {
      text: document.text.slice(range.start, range.end),
      charStart: range.start,
      charEnd: range.end,
      page: covered.find((span) => span.page !== undefined)?.page ?? null,
      startSec: timed[0]?.startSec ?? null,
      endSec: ends.length > 0 ? Math.max(...ends) : null,
    };
  });
}

/** Narrows a range to exclude surrounding whitespace, or null if it is all whitespace. */
function trimRange(text: string, start: number, end: number): Range | null {
  let from = start;
  let to = end;
  while (from < to && isSpace(text[from]!)) from += 1;
  while (to > from && isSpace(text[to - 1]!)) to -= 1;
  return to > from ? { start: from, end: to } : null;
}

const isSpace = (character: string): boolean => character === ' ' || character === '\n';

/** Index of the last space/newline in [from, to), or -1 if there is none. */
function lastWhitespace(text: string, from: number, to: number): number {
  for (let i = to - 1; i > from; i -= 1) {
    if (isSpace(text[i]!)) return i;
  }
  return -1;
}

/** Index of the first space/newline in [from, to), or -1 if there is none. */
function nextWhitespace(text: string, from: number, to: number): number {
  for (let i = from; i < to; i += 1) {
    if (isSpace(text[i]!)) return i;
  }
  return -1;
}
