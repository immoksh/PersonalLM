import { useCallback, useState } from 'react';
import {
  formatTimestamp,
  SOURCE_KIND_LABELS,
  youTubeEmbedUrl,
  youTubeWatchUrl,
  type PassageLocator,
  type SourceDetail,
} from '@personallm/shared';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { LinkIcon } from '@/components/icons';
import { Alert, Spinner } from '@/components/ui';
import { SOURCE_TYPES } from '../sourceTypes';
import { useSourceDetail } from '../useSources';
import { HighlightedText } from './HighlightedText';

export interface ViewerTarget {
  sourceId: string;
  /** Which passage to open at. Null opens the source from the top. */
  passage: PassageLocator | null;
  /** Shown above the document, so the reader knows what they are looking for. */
  quote?: string;
}

interface SourceViewerProps {
  target: ViewerTarget | null;
  onClose: () => void;
}

/**
 * Opens the source behind a citation, positioned at the passage that was cited.
 *
 * What "positioned" means depends on the kind, so each gets the treatment its
 * format allows: a PDF opens on the page, a video seeks to the second, and
 * everything else highlights the exact characters. The extracted text is shown
 * alongside the original in every case, because that text is what the answer
 * was actually generated from — being able to read it is what makes the
 * citation verifiable rather than merely plausible.
 */
export function SourceViewer({ target, onClose }: SourceViewerProps) {
  const { data: source, isPending, error } = useSourceDetail(target?.sourceId ?? null);

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      size="lg"
      title={source?.title ?? 'Source'}
      description={source ? viewerSubtitle(source, target?.passage ?? null) : 'Loading source…'}
      icon={source ? SOURCE_TYPES[source.kind].icon : undefined}
    >
      {isPending && (
        <div className="grid place-items-center py-16">
          <Spinner className="size-7 text-neon" />
        </div>
      )}

      {error && (
        <Alert>{error instanceof Error ? error.message : 'Could not open this source'}</Alert>
      )}

      {source && target && <ViewerBody source={source} target={target} />}
    </Modal>
  );
}

/** A one-line summary of what is being shown and where it sits. */
function viewerSubtitle(source: SourceDetail, passage: PassageLocator | null): string {
  const kind = SOURCE_KIND_LABELS[source.kind];
  const where = passage && describeLocation(passage, source);
  return where ? `${kind} · ${where}` : kind;
}

function describeLocation(passage: PassageLocator, source: SourceDetail): string | null {
  if (passage.page !== null) {
    return source.pageCount
      ? `page ${passage.page} of ${source.pageCount}`
      : `page ${passage.page}`;
  }
  if (passage.startSec !== null) return `at ${formatTimestamp(passage.startSec)}`;
  return null;
}

function ViewerBody({ source, target }: { source: SourceDetail; target: ViewerTarget }) {
  const { passage } = target;

  return (
    <div className="space-y-4">
      {target.quote && (
        <blockquote className="rounded-lg border-l-2 border-neon bg-neon-soft/40 px-3 py-2 text-sm text-text">
          “{target.quote}”
        </blockquote>
      )}

      {source.status !== 'ready' && (
        <Alert>
          {source.status === 'processing'
            ? 'This source is still being indexed, so the passage below may be incomplete.'
            : (source.errorMessage ?? 'Indexing this source failed. Try re-indexing it.')}
        </Alert>
      )}

      <Original source={source} passage={passage} />

      {source.extractedText ? (
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-faint uppercase">
            Indexed text
          </h3>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-surface-2 p-3">
            <HighlightedText
              text={source.extractedText}
              charStart={passage?.charStart ?? 0}
              charEnd={passage?.charEnd ?? 0}
              scrollKey={`${source.id}:${passage?.charStart ?? 0}`}
            />
          </div>
        </section>
      ) : (
        <p className="text-sm text-faint">
          No extracted text is stored for this source yet — re-index it to make its passages
          readable here.
        </p>
      )}
    </div>
  );
}

/**
 * The original artefact, when it can be shown in place: the PDF itself, the
 * video player, the rich text as it was written. Website sources are the one
 * kind that cannot be embedded — most sites refuse to be framed — so they get a
 * prominent link out instead of a broken frame.
 */
function Original({ source, passage }: { source: SourceDetail; passage: PassageLocator | null }) {
  if (source.kind === 'pdf' && source.hasFile) {
    return <PdfFrame source={source} page={passage?.page ?? null} />;
  }

  if (source.kind === 'youtube' && source.videoId) {
    return <VideoFrame videoId={source.videoId} startSec={passage?.startSec ?? null} />;
  }

  if (source.url) {
    return <ExternalLink source={source} />;
  }

  // Text and transcript sources have no separate artefact to show: the indexed
  // text below *is* the document, and the highlight is the whole answer to
  // "where did this come from".
  return null;
}

/**
 * The PDF in the browser's own viewer, opened at the cited page.
 *
 * `#page=` is a PDF fragment every major viewer honours, and it is put in a
 * `key` as well as the URL so re-opening the same document at a different page
 * remounts the frame — a fragment change alone does not re-navigate it.
 */
function PdfFrame({ source, page }: { source: SourceDetail; page: number | null }) {
  const src = `${api.sources.fileUrl(source.id)}#page=${page ?? 1}&view=FitH`;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-faint uppercase">
          Original document
        </h3>
        <a
          href={api.sources.fileUrl(source.id)}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-xs font-medium text-neon hover:underline"
        >
          <LinkIcon className="size-3.5" />
          Open full size
        </a>
      </div>
      <iframe
        key={src}
        src={src}
        title={`${source.title}, page ${page ?? 1}`}
        className="h-[26rem] w-full rounded-lg border border-border bg-surface-2"
      />
    </section>
  );
}

/** The YouTube player, seeked to the second the cited line was spoken. */
function VideoFrame({ videoId, startSec }: { videoId: string; startSec: number | null }) {
  const src = youTubeEmbedUrl(videoId, startSec);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-faint uppercase">Video</h3>
        <a
          href={youTubeWatchUrl(videoId, startSec)}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-xs font-medium text-neon hover:underline"
        >
          <LinkIcon className="size-3.5" />
          {startSec !== null ? `Watch from ${formatTimestamp(startSec)}` : 'Watch on YouTube'}
        </a>
      </div>
      <iframe
        // Keyed on the start time so citing a second moment re-seeks the player
        // instead of leaving it where the last one left it.
        key={src}
        src={src}
        title="YouTube video player"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
        allowFullScreen
        className="aspect-video w-full rounded-lg border border-border bg-black"
      />
    </section>
  );
}

/** Websites cannot be framed reliably, so the link is made the affordance. */
function ExternalLink({ source }: { source: SourceDetail }) {
  return (
    <a
      href={source.url!}
      target="_blank"
      rel="noreferrer noopener"
      className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3 transition hover:border-border-strong"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-neon-soft text-neon">
        <LinkIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-text">Open the original page</span>
        <span className="block truncate text-xs text-faint">{source.url}</span>
      </span>
    </a>
  );
}

/**
 * Holds which passage the viewer is open at.
 *
 * Spread straight onto `<SourceViewer {...viewer} />`, with `open` handed to
 * whatever renders citations.
 */
export function useSourceViewer() {
  const [target, setTarget] = useState<ViewerTarget | null>(null);

  return {
    target,
    open: useCallback((next: ViewerTarget) => setTarget(next), []),
    onClose: useCallback(() => setTarget(null), []),
  };
}
