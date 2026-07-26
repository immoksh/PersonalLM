import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateNotebookInput, Notebook, UpdateNotebookInput } from '@personallm/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';

export function useNotebooks(options?: { enabled?: boolean }) {
  return useQuery<Notebook[]>({
    queryKey: queryKeys.notebooks,
    queryFn: () => api.notebooks.list(),
    enabled: options?.enabled ?? true,
    // The per-status counts move as sources finish indexing, so keep polling
    // while any of them is still in flight.
    refetchInterval: (query) =>
      query.state.data?.some((notebook) => notebook.counts.processing > 0) ? 3000 : false,
  });
}

function useInvalidateNotebooks() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.notebooks });
}

export function useCreateNotebook() {
  const invalidate = useInvalidateNotebooks();
  return useMutation({
    mutationFn: (input: CreateNotebookInput) => api.notebooks.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdateNotebook() {
  const invalidate = useInvalidateNotebooks();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateNotebookInput & { id: string }) =>
      api.notebooks.update(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteNotebook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.notebooks.remove(id),
    onSuccess: () => {
      // Its sources went with it server-side, so drop every cached source list
      // rather than leaving the deleted notebook's rows addressable.
      void queryClient.invalidateQueries({ queryKey: queryKeys.allSources });
      return queryClient.invalidateQueries({ queryKey: queryKeys.notebooks });
    },
  });
}
