import { readPdfText } from './parsers/pdf.js';
import { htmlToText } from './parsers/text.js';
import { readTranscriptText } from './parsers/transcript.js';
import { fetchWebsiteText } from './parsers/website.js';
import { fetchYouTubeTranscript } from './parsers/youtube.js';
import { ExtractionError, type ExtractableSource } from './parsers/types.js';

/**
 * Turns a source row into plain text by dispatching to the parser for its kind.
 * This is the first stage of ingestion; chunking and embedding happen on the
 * embedding queue afterwards (see `queue/embedding.ts`).
 */
export function extractText(row: ExtractableSource): Promise<string> {
  switch (row.kind) {
    case 'pdf':
      if (!row.file_path) throw new ExtractionError('PDF source has no file on disk');
      return readPdfText(row.file_path);

    case 'transcript':
      if (!row.file_path) throw new ExtractionError('Transcript source has no file on disk');
      return readTranscriptText(row.file_path);

    case 'text':
      return Promise.resolve(htmlToText(row.content ?? ''));

    case 'website':
      if (!row.url) throw new ExtractionError('Website source has no URL');
      return fetchWebsiteText(row.url);

    case 'youtube': {
      const videoId = row.video_id ?? row.url;
      if (!videoId) throw new ExtractionError('YouTube source has no video id');
      return fetchYouTubeTranscript(videoId);
    }

    default: {
      // Exhaustiveness guard: a new SourceKind must add a parser above.
      const never: never = row.kind;
      throw new ExtractionError(`Unsupported source kind: ${String(never)}`);
    }
  }
}
