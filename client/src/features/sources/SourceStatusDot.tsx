import type { SourceStatus } from '@personallm/shared';
import { cx } from '@/components/ui';

/**
 * A traffic-light dot for a source's ingestion status:
 * green = embedded into Qdrant and ready, amber = still processing (pulsing),
 * red = ingestion failed.
 */
const STATUS_META: Record<SourceStatus, { color: string; label: string; live: boolean }> = {
  ready: { color: 'bg-status-ready', label: 'Ready', live: false },
  processing: { color: 'bg-status-processing', label: 'Processing', live: true },
  failed: { color: 'bg-status-failed', label: 'Failed', live: false },
};

export function SourceStatusDot({
  status,
  className,
}: {
  status: SourceStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      role="status"
      aria-label={meta.label}
      title={meta.label}
      className={cx('relative inline-flex size-2.5 shrink-0 rounded-full', meta.color, className)}
    >
      {/* Radiating ping while processing telegraphs that work is still happening. */}
      {meta.live && (
        <span className={cx('absolute inline-flex size-full animate-ping rounded-full', meta.color)} />
      )}
    </span>
  );
}
