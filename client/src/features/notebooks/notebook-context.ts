import { createContext, useContext } from 'react';
import type { Notebook } from '@personallm/shared';

export interface NotebookContextValue {
  /** The notebook the current route is scoped to. */
  notebook: Notebook;
}

export const NotebookContext = createContext<NotebookContextValue | null>(null);

/**
 * The open notebook, for anything rendered inside a notebook route.
 *
 * Throwing rather than returning null is what keeps the isolation guarantee
 * honest on the client: no component can accidentally query "all sources"
 * because it forgot which notebook it was in — there is no such call to make.
 */
export function useNotebook(): Notebook {
  const value = useContext(NotebookContext);
  if (!value) {
    throw new Error('useNotebook must be used inside a notebook route');
  }
  return value.notebook;
}
