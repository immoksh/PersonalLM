import fs from 'node:fs/promises';

/** Reads a caption file (`.vtt` / `.srt` / `.txt`) and reduces it to prose. */
export async function readTranscriptText(filePath: string): Promise<string> {
  const raw = await fs.readFile(filePath, 'utf8');
  return stripCaptionCues(raw);
}

/** Reduces a caption file to prose: drops timing cues, indices, and repeated lines. */
function stripCaptionCues(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === 'WEBVTT' || trimmed.startsWith('NOTE ')) continue;
    // Timestamp cues ("00:00:01.000 --> 00:00:04.000") and bare sequence numbers.
    if (trimmed.includes('-->')) continue;
    if (/^\d+$/.test(trimmed)) continue;
    // Auto-captions often repeat the previous line; collapse consecutive dupes.
    const cleaned = trimmed.replace(/<[^>]+>/g, '');
    if (cleaned && cleaned !== out[out.length - 1]) out.push(cleaned);
  }
  return out.join('\n');
}
