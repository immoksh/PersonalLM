import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Notebook } from '@personallm/shared';
import { useNotebooks, useDeleteNotebook } from '@/features/notebooks/useNotebooks';
import { NotebookFormModal } from '@/features/notebooks/NotebookFormModal';
import { LayersIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { Alert, Badge, Button, EmptyState, Spinner } from '@/components/ui';

/**
 * The shelf of notebooks — the app's front door.
 *
 * Each card is a self-contained knowledge base: opening one scopes everything
 * downstream (its library, its chat, its answers) to that notebook alone.
 */
export function NotebooksPage() {
  const navigate = useNavigate();
  const { data: notebooks, isPending, error } = useNotebooks();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Notebook | undefined>(undefined);

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-7 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-text">
            Your <span className="text-gradient">notebooks</span>
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Each notebook has its own sources. Answers never cross between them.
          </p>
        </div>
        <Button onClick={openCreate}>
          <PlusIcon className="size-4" />
          New notebook
        </Button>
      </header>

      {error && (
        <Alert>{error instanceof Error ? error.message : 'Could not load your notebooks'}</Alert>
      )}

      {isPending ? (
        <div className="grid place-items-center py-20">
          <Spinner className="size-8 text-neon" />
        </div>
      ) : !notebooks || notebooks.length === 0 ? (
        <EmptyState
          icon={<LayersIcon className="size-6" />}
          title="No notebooks yet"
          description="Create one to start collecting sources and asking questions about them."
          action={
            <Button onClick={openCreate}>
              <PlusIcon className="size-4" />
              New notebook
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {notebooks.map((notebook) => (
            <NotebookCard
              key={notebook.id}
              notebook={notebook}
              onRename={() => {
                setEditing(notebook);
                setFormOpen(true);
              }}
            />
          ))}
        </div>
      )}

      <NotebookFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        notebook={editing}
        onCreated={(created) => navigate(`/notebooks/${created.id}`)}
      />
    </div>
  );
}

function NotebookCard({ notebook, onRename }: { notebook: Notebook; onRename: () => void }) {
  const remove = useDeleteNotebook();

  const confirmRemove = () => {
    const warning =
      notebook.sourceCount > 0
        ? `Delete “${notebook.title}” and its ${notebook.sourceCount} source${
            notebook.sourceCount === 1 ? '' : 's'
          }? This cannot be undone.`
        : `Delete “${notebook.title}”?`;
    if (window.confirm(warning)) remove.mutate(notebook.id);
  };

  return (
    <article className="group relative flex flex-col rounded-xl2 border border-border bg-surface p-5 transition hover:border-border-strong">
      {/* The whole card is the link; the action buttons sit above it in z-order
          so they stay clickable. */}
      <Link
        to={`/notebooks/${notebook.id}`}
        className="absolute inset-0 rounded-xl2"
        aria-label={`Open ${notebook.title}`}
      />

      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-2xl">
          {notebook.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium text-text">{notebook.title}</h2>
          <p className="mt-0.5 text-xs text-faint">
            {notebook.sourceCount === 1 ? '1 source' : `${notebook.sourceCount} sources`}
          </p>
        </div>

        <button
          type="button"
          onClick={confirmRemove}
          aria-label={`Delete ${notebook.title}`}
          className="relative z-10 shrink-0 rounded-lg p-1.5 text-faint opacity-0 transition hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
        >
          <TrashIcon className="size-4" />
        </button>
      </div>

      {notebook.description && (
        <p className="mt-3 line-clamp-2 text-sm text-muted">{notebook.description}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {notebook.counts.ready > 0 && <Badge tone="neon">{notebook.counts.ready} ready</Badge>}
        {notebook.counts.processing > 0 && <Badge>{notebook.counts.processing} indexing</Badge>}
        {notebook.counts.failed > 0 && <Badge tone="violet">{notebook.counts.failed} failed</Badge>}
        <button
          type="button"
          onClick={onRename}
          className="relative z-10 ml-auto text-xs font-medium text-faint transition hover:text-text"
        >
          Rename
        </button>
      </div>
    </article>
  );
}
