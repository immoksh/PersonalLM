import { readPdfPages } from './parsers/pdf.js';
import { htmlToText } from './parsers/text.js';
import { readTranscriptSegments } from './parsers/transcript.js';
import { fetchWebsiteContent } from './parsers/website.js';
import { fetchYouTubeTranscript } from './parsers/youtube.js';
import {
  asSingleSegment,
  ExtractionError,
  type ExtractableSource,
  type ExtractedContent,
} from './parsers/types.js';

/**
 * Turns a source row into located segments by dispatching to the parser for its
 * kind. This is the first stage of ingestion; chunking and embedding happen on
 * the embedding queue afterwards (see `queue/embedding.ts`).
 *
 * Segments rather than one flat string, because the position each parser knows
 * about — the PDF page, the caption timestamp — has to reach the citation, and
 * here is the only place it exists.
 */
export function extractContent(row: ExtractableSource): Promise<ExtractedContent> {
  switch (row.kind) {
    case 'pdf':
      if (!row.file_path) throw new ExtractionError('PDF source has no file on disk');
      return readPdfPages(row.file_path);

    case 'transcript':
      if (!row.file_path) throw new ExtractionError('Transcript source has no file on disk');
      return readTranscriptSegments(row.file_path);

    case 'text':
      return Promise.resolve(asSingleSegment(htmlToText(row.content ?? '')));

    case 'website':
      if (!row.url) throw new ExtractionError('Website source has no URL');
      return fetchWebsiteContent(row.url);

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
