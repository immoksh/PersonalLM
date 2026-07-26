import type { Source } from '@personallm/shared';
import { SourceStatusDot } from '@/features/sources/SourceStatusDot';
import { cx } from '@/components/ui';

interface SourceScopePickerProps {
  sources: Source[];
  /** Selected ids. Empty means "the whole notebook". */
  selected: string[];
  onChange: (selected: string[]) => void;
}

/**
 * Narrows a question to some of the notebook's sources.
 *
 * Selecting nothing means the whole notebook rather than nothing at all, which
 * is both the useful default and what the API does with an omitted list. Only
 * `ready` sources can be picked — anything still indexing has no vectors to
 * retrieve from, so offering it would promise an answer it cannot support.
 */
export function SourceScopePicker({ sources, selected, onChange }: SourceScopePickerProps) {
  const ready = sources.filter((source) => source.status === 'ready');
  if (ready.length === 0) return null;

  const toggle = (id: string) =>
    onChange(
      selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id],
    );

  const all = selected.length === 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange([])}
        aria-pressed={all}
        className={cx(
          'rounded-full border px-2.5 py-1 text-xs font-medium transition',
          all
            ? 'border-neon bg-neon-soft text-neon'
            : 'border-border text-muted hover:border-border-strong hover:text-text',
        )}
      >
        All sources
      </button>

      {ready.map((source) => {
        const active = selected.includes(source.id);
        return (
          <button
            key={source.id}
            type="button"
            onClick={() => toggle(source.id)}
            aria-pressed={active}
            title={source.title}
            className={cx(
              'flex max-w-48 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition',
              active
                ? 'border-neon bg-neon-soft text-neon'
                : 'border-border text-muted hover:border-border-strong hover:text-text',
            )}
          >
            <SourceStatusDot status={source.status} className="size-1.5" />
            <span className="truncate">{source.title}</span>
          </button>
        );
      })}
    </div>
  );
}
