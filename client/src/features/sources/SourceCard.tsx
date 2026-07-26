import { formatBytes, youTubeThumbnail, type Source } from '@personallm/shared';
import { RefreshIcon, TrashIcon } from '@/components/icons';
import { Badge, cx } from '@/components/ui';
import { useDeleteSource, useReindexSource } from './useSources';
import { SourceStatusDot } from './SourceStatusDot';
import { SOURCE_TYPES } from './sourceTypes';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Secondary line under the title, specific to what the source actually is. */
function metaLine(source: Source): string {
  if (source.fileName) {
    return source.fileSize ? formatBytes(source.fileSize) : source.fileName;
  }
  if (source.url) {
    try {
      return new URL(source.url).hostname.replace(/^www\./, '');
    } catch {
      return source.url;
    }
  }
  // Text sources render their preview as the card body, so repeating it here
  // would show the same sentence twice.
  return '';
}

interface SourceCardProps {
  source: Source;
  /** Opens the source viewer on this source. */
  onOpen: () => void;
}

export function SourceCard({ source, onOpen }: SourceCardProps) {
  const meta = SOURCE_TYPES[source.kind];
  const deleteSource = useDeleteSource();
  const reindexSource = useReindexSource();

  const isProcessing = source.status === 'processing';

  const remove = () => {
    if (window.confirm(`Remove “${source.title}”? This cannot be undone.`)) {
      deleteSource.mutate(source.id);
    }
  };

  const reindex = () => {
    reindexSource.reset(); // Clear a previous failure before trying again.
    reindexSource.mutate(source.id);
  };

  return (
    <article
      className={cx(
        'group relative flex flex-col overflow-hidden rounded-xl2 border border-border bg-surface transition',
        'hover:-translate-y-0.5 hover:border-border-strong hover:shadow-xl',
        deleteSource.isPending && 'pointer-events-none opacity-50',
      )}
    >
      {source.videoId && (
        // Fixed height rather than aspect-video: a 16:9 thumbnail makes this
        // card far taller than its neighbours, and every card in the row
        // stretches to match it.
        <img
          src={youTubeThumbnail(source.videoId)}
          alt=""
          loading="lazy"
          className="h-28 w-full object-cover"
        />
      )}

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          <span
            className={cx(
              'grid size-9 shrink-0 place-items-center rounded-lg',
              meta.accent === 'neon' ? 'bg-neon-soft text-neon' : 'bg-violet-soft text-violet',
            )}
          >
            {meta.icon}
          </span>

          <div className="min-w-0 flex-1">
            <h3 className="truncate font-medium text-text" title={source.title}>
              {/* The title is the affordance for opening the source, so the
                  whole card stays free for the action buttons. */}
              <button
                type="button"
                onClick={onOpen}
                className="max-w-full truncate text-left transition hover:text-neon"
              >
                {source.title}
              </button>
            </h3>
            <p className="truncate text-xs text-faint">{metaLine(source)}</p>
          </div>

          {/* Actions stay hidden until hover/focus so the grid reads calmly. */}
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              onClick={reindex}
              // A source already in flight would race its own re-index, and the
              // server rejects it with a 409 anyway.
              disabled={isProcessing || reindexSource.isPending}
              aria-label={`Re-index ${source.title}`}
              title={isProcessing ? 'Already indexing' : 'Re-index this source'}
              className="rounded-lg p-1.5 text-faint transition hover:bg-neon-soft hover:text-neon disabled:pointer-events-none disabled:opacity-40"
            >
              <RefreshIcon className={cx('size-4', reindexSource.isPending && 'animate-spin')} />
            </button>

            <button
              type="button"
              onClick={remove}
              aria-label={`Remove ${source.title}`}
              className="rounded-lg p-1.5 text-faint transition hover:bg-danger/10 hover:text-danger"
            >
              <TrashIcon className="size-4" />
            </button>
          </div>
        </div>

        {reindexSource.isError && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {reindexSource.error instanceof Error
              ? reindexSource.error.message
              : 'Could not re-index this source'}
          </p>
        )}

        {/* Rendered as text, never as HTML — the stored rich text is untrusted. */}
        {source.kind === 'text' && source.preview && (
          <p className="mt-3 line-clamp-3 text-sm text-muted">{source.preview}</p>
        )}

        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 truncate text-sm text-neon hover:underline"
          >
            {source.url}
          </a>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <div className="flex items-center gap-2">
            <Badge tone={meta.accent}>{meta.label}</Badge>
            {/* Says why the re-index button is there when ingestion failed. */}
            <SourceStatusDot status={source.status} />
          </div>
          <time dateTime={source.createdAt} className="text-xs text-faint">
            {formatDate(source.createdAt)}
          </time>
        </div>
      </div>
    </article>
  );
}
