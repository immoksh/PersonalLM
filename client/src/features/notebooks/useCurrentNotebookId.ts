import { useLocation } from 'react-router-dom';

const NOTEBOOK_PATH = /^\/notebooks\/([^/]+)/;

/**
 * The notebook the URL is pointing at, or null outside a notebook route.
 *
 * Read from the path rather than through `useParams`, which only exposes the
 * params of the route that declared them — the layout and sidebar render
 * *above* `/notebooks/:notebookId`, so params there are always empty. Anything
 * inside a notebook route should use `useNotebook` instead, which hands back
 * the loaded notebook rather than a bare id.
 */
export function useCurrentNotebookId(): string | null {
  const { pathname } = useLocation();
  return NOTEBOOK_PATH.exec(pathname)?.[1] ?? null;
}
