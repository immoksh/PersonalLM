import { useState } from 'react';
import type { SourceKind } from '@personallm/shared';
import { useDebounced } from '@/lib/useDebounced';
import { useAddSource } from '@/features/sources/add-source-context';
import { useSources } from '@/features/sources/useSources';
import { SourceCard } from '@/features/sources/SourceCard';
import { SOURCE_TYPE_LIST } from '@/features/sources/sourceTypes';
import { LayersIcon, PlusIcon, SearchIcon } from '@/components/icons';
import { Alert, Button, EmptyState, Spinner, TextInput, cx } from '@/components/ui';

type Filter = SourceKind | 'all';

export function SourcesPage() {
  const { open: openAddSource } = useAddSource();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const debouncedSearch = useDebounced(search);
  const { data: sources, isPending, isFetching, error } = useSources(filter, debouncedSearch);

  const isFiltered = filter !== 'all' || debouncedSearch !== '';
  const items = sources ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-7 px-4 py-8 sm:px-6 lg:px-8">
      {/* No Add Source button here: the sidebar carries it, and a second one
          would crowd the avatar that now sits in the top-right corner. */}
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-text">
          Your <span className="text-gradient">sources</span>
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {sources
            ? `${sources.length} ${sources.length === 1 ? 'source' : 'sources'} in your library`
            : 'Loading your library…'}
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <TextInput
            type="search"
            aria-label="Search sources"
            placeholder="Search by title or link…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        {isFetching && !isPending && <Spinner className="size-4 shrink-0 text-muted" />}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by source type">
        {[{ kind: 'all' as const, label: 'All' }, ...SOURCE_TYPE_LIST].map((type) => {
          const active = filter === type.kind;
          return (
            <button
              key={type.kind}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(type.kind)}
              className={cx(
                'rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                active
                  ? 'border-neon bg-neon-soft text-neon'
                  : 'border-border text-muted hover:border-border-strong hover:text-text',
              )}
            >
              {type.label}
            </button>
          );
        })}
      </div>

      {error && (
        <Alert>{error instanceof Error ? error.message : 'Could not load your sources'}</Alert>
      )}

      {isPending ? (
        <div className="grid place-items-center py-20">
          <Spinner className="size-8 text-neon" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<LayersIcon className="size-6" />}
          title={isFiltered ? 'Nothing matches that' : 'Your library is empty'}
          description={
            isFiltered
              ? 'Try a different search term or clear the filter.'
              : 'Add a PDF, some text, a website, a YouTube video or a transcript to get started.'
          }
          action={
            isFiltered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setFilter('all');
                  setSearch('');
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button onClick={openAddSource}>
                <PlusIcon className="size-4" />
                Add Source
              </Button>
            )
          }
        />
      ) : (
        // Cards stretch to a common height per row so the grid reads as even
        // rows; SourceCard pins its footer to the bottom to suit that.
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </div>
      )}
    </div>
  );
}
