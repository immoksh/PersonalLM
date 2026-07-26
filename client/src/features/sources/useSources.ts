import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTextSourceInput,
  CreateWebsiteSourceInput,
  CreateYouTubeSourceInput,
  FileSourceKind,
  Source,
  SourceDetail,
  SourceKind,
} from '@personallm/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';

/** Cache-key params for one source list. */
interface ListParams {
  notebookId: string;
  kind: string;
  search: string;
}

export function useSources(
  notebookId: string,
  kind: SourceKind | 'all',
  search: string,
  options?: { enabled?: boolean },
) {
  return useQuery<Source[]>({
    queryKey: queryKeys.sources(notebookId, kind, search),
    queryFn: () =>
      api.sources.list({
        notebookId,
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

/** One source with its extracted text — loaded on demand by the source viewer. */
export function useSourceDetail(id: string | null) {
  return useQuery<SourceDetail>({
    queryKey: queryKeys.source(id ?? ''),
    queryFn: () => api.sources.read(id!),
    enabled: Boolean(id),
    // The extracted text only changes on a re-index, so there is no reason to
    // re-download a whole document each time a citation is opened.
    staleTime: 5 * 60_000,
  });
}

/** Refetches every cached list, so server ordering and filtering win. */
function useInvalidateSources() {
  const queryClient = useQueryClient();
  return () => {
    // A notebook's per-status counts move with every add and removal.
    void queryClient.invalidateQueries({ queryKey: queryKeys.notebooks });
    return queryClient.invalidateQueries({ queryKey: queryKeys.allSources });
  };
}

/**
 * Whether a just-created source belongs in the list cached under `params`.
 * A search is matched server-side with LIKE over three columns, so any list
 * with a search term is left to the refetch rather than guessed at here.
 */
function belongsInList(source: Source, params: ListParams): boolean {
  // Never seed across notebooks: a list is scoped to one, and putting a source
  // in the wrong one would show it somewhere it can never be queried from.
  if (params.notebookId !== source.notebookId) return false;
  if (params.search) return false;
  return params.kind === 'all' || params.kind === source.kind;
}

/**
 * Drops freshly created sources into the lists that already hold them, instead
 * of waiting for the invalidate's round-trip. That refetch shares an event loop
 * with the inline ingestion worker (see `INGEST_INLINE_WORKER`), whose
 * extraction step blocks it for as long as the new source takes to parse — so
 * the sidebar could sit a few seconds behind the source it just accepted.
 * Rows are prepended because the API orders by `created_at DESC`, which is the
 * ordering the following refetch restores anyway.
 */
function useSeedCreatedSources() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateSources();

  return (created: Source[]) => {
    // Walking the cache rather than `setQueriesData`, which hands the updater
    // the data alone: each list has to be patched against its own key filter.
    for (const query of queryClient.getQueryCache().findAll({ queryKey: queryKeys.allSources })) {
      const params = query.queryKey[1] as ListParams | undefined;
      const cached = query.state.data as Source[] | undefined;
      if (!params || !cached) continue; // Nothing cached yet; the fetch brings it all.

      const fresh = created.filter(
        (source) =>
          belongsInList(source, params) &&
          // Guard against a refetch that already landed these rows.
          !cached.some((existing) => existing.id === source.id),
      );
      if (fresh.length > 0) {
        queryClient.setQueryData<Source[]>(query.queryKey, [...fresh, ...cached]);
      }
    }

    return invalidate();
  };
}

export function useCreateTextSource() {
  const seed = useSeedCreatedSources();
  return useMutation({
    mutationFn: (input: CreateTextSourceInput) => api.sources.createText(input),
    onSuccess: (source) => seed([source]),
  });
}

export function useCreateWebsiteSource() {
  const seed = useSeedCreatedSources();
  return useMutation({
    mutationFn: (input: CreateWebsiteSourceInput) => api.sources.createWebsite(input),
    onSuccess: (source) => seed([source]),
  });
}

export function useCreateYouTubeSource() {
  const seed = useSeedCreatedSources();
  return useMutation({
    mutationFn: (input: CreateYouTubeSourceInput) => api.sources.createYouTube(input),
    onSuccess: (source) => seed([source]),
  });
}

export function useUploadSources() {
  const seed = useSeedCreatedSources();
  return useMutation({
    mutationFn: ({
      notebookId,
      kind,
      files,
    }: {
      notebookId: string;
      kind: FileSourceKind;
      files: File[];
    }) => api.sources.createFiles(notebookId, kind, files),
    onSuccess: (sources) => seed(sources),
  });
}

export function useReindexSource() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateSources();
  return useMutation({
    mutationFn: (id: string) => api.sources.reindex(id),
    onSuccess: (source) => {
      // Re-extraction rewrites the stored text the viewer highlights into, so
      // the cached detail is stale the moment a re-index is queued.
      void queryClient.invalidateQueries({ queryKey: queryKeys.source(source.id) });
      // The refetch picks the source up as `processing`, which restarts the
      // status polling in `useSources`.
      return invalidate();
    },
  });
}

export function useDeleteSource() {
  const invalidate = useInvalidateSources();
  return useMutation({
    mutationFn: (id: string) => api.sources.remove(id),
    onSuccess: invalidate,
  });
}
