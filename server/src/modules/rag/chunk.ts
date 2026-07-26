import { config } from '../../config/rag.js';

/**
 * Split text into overlapping chunks (~chunkSize chars, chunkOverlap overlap),
 * breaking on whitespace boundaries where possible so words stay intact.
 */
export function chunkText(
  text: string,
  chunkSize: number = config.chunking.chunkSize,
  overlap: number = config.chunking.chunkOverlap,
): string[] {
  // Collapse runs of horizontal whitespace to single spaces but keep newlines,
  // so paragraph boundaries survive as candidate cut points.
  const normalized = text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);

    // Prefer to cut on the last whitespace inside the window, unless that would
    // shrink the chunk below half size (a very long unbroken token).
    if (end < normalized.length) {
      const boundary = lastWhitespace(normalized, start, end);
      if (boundary > start + chunkSize / 2) end = boundary;
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= normalized.length) break;

    // Step forward keeping ~`overlap` chars of context, but snap that start to
    // the next word boundary so the following chunk also begins cleanly.
    let next = end - overlap;
    if (next > start) {
      const boundary = nextWhitespace(normalized, next, end);
      if (boundary !== -1) next = boundary + 1;
    }
    start = next > start ? next : end; // never stall
  }

  return chunks;
}

/** Index of the last space/newline in [from, to), or -1 if there is none. */
function lastWhitespace(text: string, from: number, to: number): number {
  for (let i = to - 1; i > from; i -= 1) {
    if (text[i] === ' ' || text[i] === '\n') return i;
  }
  return -1;
}

/** Index of the first space/newline in [from, to), or -1 if there is none. */
function nextWhitespace(text: string, from: number, to: number): number {
  for (let i = from; i < to; i += 1) {
    if (text[i] === ' ' || text[i] === '\n') return i;
  }
  return -1;
}
