import { QueryClient } from '@tanstack/react-query';
import { ApiClientError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Retrying a 4xx just repeats the same rejection.
        if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

export const queryKeys = {
  me: ['auth', 'me'] as const,
  notebooks: ['notebooks'] as const,
  /** Source lists are per notebook, so the key carries it and nothing leaks across. */
  sources: (notebookId: string, kind: string, search: string) =>
    ['sources', { notebookId, kind, search }] as const,
  allSources: ['sources'] as const,
  source: (id: string) => ['source', id] as const,
};
