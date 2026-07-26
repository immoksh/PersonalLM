import { useMemo } from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Notebook } from '@personallm/shared';
import { api, ApiClientError } from '@/lib/api';
import { Alert, Spinner } from '@/components/ui';
import { NotebookContext } from './notebook-context';

/**
 * Resolves `:notebookId` into the notebook every nested route works against.
 *
 * Nothing inside renders until it exists, which is what lets `useNotebook`
 * return a notebook rather than a maybe-notebook — the pages below never have
 * to handle "no notebook selected" as a state.
 */
export function NotebookRoute() {
  const { notebookId } = useParams<{ notebookId: string }>();

  const {
    data: notebook,
    isPending,
    error,
  } = useQuery<Notebook>({
    queryKey: ['notebook', notebookId],
    queryFn: () => api.notebooks.read(notebookId!),
    enabled: Boolean(notebookId),
  });

  const value = useMemo(() => (notebook ? { notebook } : null), [notebook]);

  // A deleted or someone else's notebook 404s; bounce to the shelf rather than
  // leaving a dead URL that looks like an app error.
  if (error instanceof ApiClientError && error.status === 404) {
    return <Navigate to="/notebooks" replace />;
  }

  if (isPending) {
    return (
      <div className="grid flex-1 place-items-center py-24">
        <Spinner className="size-8 text-neon" />
      </div>
    );
  }

  if (!value) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <Alert>
          {error instanceof Error ? error.message : 'Could not open this notebook'}
        </Alert>
      </div>
    );
  }

  return (
    <NotebookContext.Provider value={value}>
      <Outlet />
    </NotebookContext.Provider>
  );
}
