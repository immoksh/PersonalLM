import fs from 'node:fs/promises';
import { asSingleSegment, type ExtractedContent, type ExtractedSegment } from './types.js';

/**
 * Reads a caption file (`.vtt` / `.srt` / `.txt`) as timed segments.
 *
 * The cue timings are the point: a transcript citation that cannot say *when*
 * the quoted line was said sends the reader back to scrubbing the whole file.
 * Sources with no cues at all (a plain `.txt`) fall back to one untimed
 * segment, so the passage is still highlightable by character offset.
 */
export async function readTranscriptSegments(filePath: string): Promise<ExtractedContent> {
  const raw = await fs.readFile(filePath, 'utf8');
  const segments = parseCues(raw);
  return segments.length > 0 ? { segments } : asSingleSegment(stripUntimed(raw));
}

/** `00:01:02.500` / `00:01:02,500` / `01:02.500` -> seconds. */
function parseCueTime(value: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(value.trim());
  if (!match) return null;

  const [, hours, minutes, seconds, fraction] = match;
  return (
    Number(hours ?? 0) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    // Padded, so `.5` reads as 500ms rather than 5ms.
    Number(fraction.padEnd(3, '0')) / 1000
  );
}

const CUE_LINE = /^(\S+)\s+-->\s+(\S+)/;

/**
 * Walks WebVTT/SRT cue blocks, pairing each timing line with the text beneath
 * it. Anything before the first cue (the `WEBVTT` header, `NOTE` blocks) and
 * the bare sequence numbers SRT puts above each cue are skipped.
 */
function parseCues(raw: string): ExtractedSegment[] {
  const lines = raw.split(/\r?\n/);
  const segments: ExtractedSegment[] = [];

  // The open cue's timing, held until its text lines have been collected.
  let current: Omit<ExtractedSegment, 'text'> | null = null;
  let pending: string[] = [];

  const flush = () => {
    if (!current) return;
    const text = pending.join(' ').trim();
    // Auto-captions repeat the previous cue's line as they scroll; dropping a
    // consecutive duplicate keeps the indexed text readable.
    if (text && text !== segments[segments.length - 1]?.text) {
      segments.push({ ...current, text });
    }
    current = null;
    pending = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const cue = CUE_LINE.exec(trimmed);

    if (cue) {
      flush();
      const startSec = parseCueTime(cue[1]);
      const endSec = parseCueTime(cue[2]);
      // A malformed timing still opens a cue block, so its text is not silently
      // merged into the previous cue's — it just carries no timestamp.
      current = startSec === null ? {} : { startSec, ...(endSec === null ? {} : { endSec }) };
      continue;
    }

    if (!current) continue; // Preamble, before the first cue.
    if (!trimmed) {
      flush();
      continue;
    }
    if (/^\d+$/.test(trimmed)) continue; // SRT sequence number.

    // Strip the inline karaoke/voice tags WebVTT allows (`<c>`, `<00:00:01.000>`).
    pending.push(trimmed.replace(/<[^>]+>/g, ''));
  }
  flush();

  return segments;
}

/** Fallback for caption-less files: drop the obvious noise, keep the prose. */
function stripUntimed(raw: string): string {
  const kept: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/<[^>]+>/g, '');
    if (!trimmed || trimmed === 'WEBVTT' || trimmed.startsWith('NOTE ')) continue;
    if (/^\d+$/.test(trimmed)) continue;
    if (trimmed !== kept[kept.length - 1]) kept.push(trimmed);
  }
  return kept.join('\n');
}
