import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTextSourceInput,
  CreateWebsiteSourceInput,
  CreateYouTubeSourceInput,
  FileSourceKind,
  Source,
  SourceKind,
} from '@personallm/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';

export function useSources(
  kind: SourceKind | 'all',
  search: string,
  options?: { enabled?: boolean },
) {
  return useQuery<Source[]>({
    queryKey: queryKeys.sources(kind, search),
    queryFn: () =>
      api.sources.list({
        ...(kind === 'all' ? {} : { kind }),
        ...(search ? { q: search } : {}),
      }),
    placeholderData: (previous) => previous, // Keeps the grid visible while filtering.
    enabled: options?.enabled ?? true,
    // Ingestion is async (BullMQ), so poll while anything is still processing;
    // this flips the sidebar status dots green the moment Qdrant upsert finishes.
    refetchInterval: (query) =>
      query.state.data?.some((source) => source.status === 'processing') ? 2500 : false,
  });
}

/** Every mutation refetches rather than patching, so server ordering wins. */
function useInvalidateSources() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.allSources });
}

export function useCreateTextSource() {
  const invalidate = useInvalidateSources();
  return useMutation({
    mutationFn: (input: CreateTextSourceInput) => api.sources.createText(input),
    onSuccess: invalidate,
  });
}

export function useCreateWebsiteSource() {
  const invalidate = useInvalidateSources();
  return useMutation({
    mutationFn: (input: CreateWebsiteSourceInput) => api.sources.createWebsite(input),
    onSuccess: invalidate,
  });
}

export function useCreateYouTubeSource() {
  const invalidate = useInvalidateSources();
  return useMutation({
    mutationFn: (input: CreateYouTubeSourceInput) => api.sources.createYouTube(input),
    onSuccess: invalidate,
  });
}

export function useUploadSources() {
  const invalidate = useInvalidateSources();
  return useMutation({
    mutationFn: ({ kind, files }: { kind: FileSourceKind; files: File[] }) =>
      api.sources.createFiles(kind, files),
    onSuccess: invalidate,
  });
}

export function useDeleteSource() {
  const invalidate = useInvalidateSources();
  return useMutation({
    mutationFn: (id: string) => api.sources.remove(id),
    onSuccess: invalidate,
  });
}
