import { YoutubeTranscript } from 'youtube-transcript';
import { ExtractionError } from './types.js';

export async function fetchYouTubeTranscript(videoIdOrUrl: string): Promise<string> {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoIdOrUrl);
    return segments.map((segment) => segment.text).join(' ');
  } catch (error) {
    throw new ExtractionError(
      `No transcript available for this video: ${(error as Error).message}`,
    );
  }
}
