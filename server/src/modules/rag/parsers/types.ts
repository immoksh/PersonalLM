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

/** Thrown when a source yields no usable text; ingestion marks it `failed`. */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}
