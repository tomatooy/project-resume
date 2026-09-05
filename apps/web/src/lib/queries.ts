import {
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"
import {
  createResume,
  createSnapshot,
  decideSuggestions,
  deleteResume,
  duplicateResume,
  getOrCreateConversation,
  getResume,
  getVersion,
  listMessages,
  listResumes,
  listVersions,
  renameResume,
  restoreVersion,
} from "./api"

/**
 * The browser's server state, as one module.
 *
 * A query here is the key, the fetcher, and the cache policy as a single value,
 * so a loader, a component, and a cache write (`setQueryData`) cannot disagree
 * about any of them. A mutation hook owns what it invalidates, so a screen
 * that renames a resume does not have to know the rail lists resumes.
 *
 * Screens add their own side effects (a toast, a navigation) through the
 * per-call `mutate(vars, { onSuccess })`, which runs after the hook's own.
 */

/* -------------------------------------------------------------- queries */

export const resumesQuery = () =>
  queryOptions({
    queryKey: ["resumes"] as const,
    queryFn: listResumes,
  })

export const resumeQuery = (id: string) =>
  queryOptions({
    queryKey: ["resume", id] as const,
    queryFn: () => getResume({ id }),
  })

/**
 * The conversation is created on first open and never changes for a resume,
 * so it is fetched once per session rather than on every loader pass.
 */
export const conversationQuery = (resumeId: string) =>
  queryOptions({
    queryKey: ["conversation", resumeId] as const,
    queryFn: () => getOrCreateConversation({ resumeId }),
    staleTime: Number.POSITIVE_INFINITY,
  })

export const versionsQuery = (resumeId: string) =>
  queryOptions({
    queryKey: ["versions", resumeId] as const,
    queryFn: () => listVersions({ resumeId }),
  })

export const versionQuery = (versionId: string) =>
  queryOptions({
    queryKey: ["version", versionId] as const,
    queryFn: () => getVersion({ id: versionId }),
  })

/**
 * The transcript is fetched once and handed to `useChat` as its starting
 * state; from then on the stream keeps it current. Never refetched while the
 * panel is open, since that would replace what the user is watching.
 */
export const messagesQuery = (conversationId: string) =>
  queryOptions({
    queryKey: ["messages", conversationId] as const,
    queryFn: () => listMessages(conversationId),
    staleTime: Number.POSITIVE_INFINITY,
  })

/* ------------------------------------------------------------ cache ops */

/** After anything that may have written a version: accept, save, restore. */
export function invalidateVersions(
  queryClient: QueryClient,
  resumeId: string
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: versionsQuery(resumeId).queryKey,
  })
}

/* ------------------------------------------------------------ mutations */

function useResumeListMutation<TVars, TOut>(
  mutationFn: (vars: TVars) => Promise<TOut>
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: resumesQuery().queryKey }),
  })
}

export function useCreateResume() {
  return useResumeListMutation(
    (input: { title?: string; fromResumeId?: string } = {}) =>
      createResume(input)
  )
}

export function useDuplicateResume() {
  return useResumeListMutation((id: string) => duplicateResume({ id }))
}

export function useDeleteResume() {
  return useResumeListMutation((id: string) => deleteResume({ id }))
}

export function useRenameResume() {
  return useResumeListMutation((input: { id: string; title: string }) =>
    renameResume(input)
  )
}

export function useCreateSnapshot(resumeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => createSnapshot({ resumeId }),
    onSuccess: () => invalidateVersions(queryClient, resumeId),
  })
}

export function useRestoreVersion(resumeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (versionId: string) => restoreVersion({ resumeId, versionId }),
    onSuccess: () => invalidateVersions(queryClient, resumeId),
  })
}

/**
 * Accepting or rejecting suggestions. Only an accept can write a version, and
 * the result says whether one did, so the list is refreshed only then.
 */
export function useDecideSuggestions(resumeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: decideSuggestions,
    onSuccess: async (result) => {
      if (result.version) await invalidateVersions(queryClient, resumeId)
    },
  })
}
