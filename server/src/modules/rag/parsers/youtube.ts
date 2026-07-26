import { YoutubeTranscript, type TranscriptResponse } from 'youtube-transcript';
import { ExtractionError, type ExtractedContent } from './types.js';

/**
 * Fetches a video's transcript as timed segments, so a citation can deep-link
 * the player to the second the quoted line was spoken.
 */
export async function fetchYouTubeTranscript(videoIdOrUrl: string): Promise<ExtractedContent> {
  let cues: TranscriptResponse[];
  try {
    cues = await YoutubeTranscript.fetchTranscript(videoIdOrUrl);
  } catch (error) {
    throw new ExtractionError(`No transcript available for this video: ${(error as Error).message}`);
  }

  const scale = secondsPerUnit(cues);
  const segments = cues
    .map((cue) => {
      const startSec = cue.offset * scale;
      return { text: cue.text.trim(), startSec, endSec: startSec + cue.duration * scale };
    })
    .filter((segment) => segment.text.length > 0);

  return { segments };
}

/**
 * How many seconds one unit of `offset`/`duration` represents.
 *
 * `youtube-transcript` reports milliseconds when it parses YouTube's srv3
 * caption format and seconds when it falls back to the older one, with nothing
 * on the response to say which — and guessing wrong sends every citation to the
 * wrong moment, or past the end of the video. Cue *durations* separate the two
 * cleanly: a caption is on screen for a few seconds, so a median duration above
 * 100 can only be milliseconds. Median rather than mean, so one trailing cue
 * with a bogus duration cannot decide the units for the whole transcript.
 */
function secondsPerUnit(cues: TranscriptResponse[]): number {
  const durations = cues
    .map((cue) => cue.duration)
    .filter((duration) => Number.isFinite(duration) && duration > 0)
    .sort((a, b) => a - b);

  if (durations.length === 0) return 1;
  return durations[Math.floor(durations.length / 2)]! > 100 ? 1 / 1000 : 1;
}
