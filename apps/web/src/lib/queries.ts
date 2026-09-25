import {
  keepPreviousData,
  infiniteQueryOptions,
  useInfiniteQuery,
  useQueries,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"
import {
  cancelChatRun,
  clearConversation,
  createResume,
  createSnapshot,
  createUserSkill,
  decideSuggestions,
  deleteResume,
  deleteUserSkill,
  duplicateResume,
  getOrCreateConversation,
  getResume,
  getUserSkill,
  getVersion,
  importSkillMarkdown,
  listMessages,
  listResumePage,
  getResumeSummary,
  listSkills,
  listVersions,
  renameResume,
  restoreVersion,
  searchResumes,
  setSkillEnabled,
  updateUserSkill,
} from "./api"
import type { ChatHistory } from "./types"
import type { ResumeState } from "@/features/resume/store"
import { UserSkillInputSchema, type SkillDraft } from "@workspace/resume-core"

export function cacheWorkspaceResume(
  client: QueryClient,
  state: ResumeState
): void {
  client.setQueryData(resumeQuery(state.resumeId).queryKey, (record) =>
    record
      ? {
          ...record,
          data: state.doc,
          revision: state.revision,
          updatedAt: state.updatedAt,
          templateId: state.templateId,
          templateOptions: state.templateOptions,
        }
      : record
  )
}

export function cacheWorkspaceMessages(
  client: QueryClient,
  conversationId: string,
  history: ChatHistory
): void {
  client.setQueryData(messagesQuery(conversationId).queryKey, history)
}

export function workspaceAssistantApi(client: QueryClient, resumeId: string) {
  return {
    cancelChatRun,
    decideSuggestions: (input: Parameters<typeof decideSuggestions>[0]) =>
      decideResumeSuggestions(client, resumeId, input),
    clearConversation: (input: Parameters<typeof clearConversation>[0]) =>
      clearChatConversation(client, input.conversationId),
  }
}

export async function releaseWorkspaceResume(
  client: QueryClient,
  resumeId: string,
  conversationId: string | null
): Promise<void> {
  client.removeQueries({
    queryKey: resumeQuery(resumeId).queryKey,
    exact: true,
  })
  await Promise.all([
    conversationId
      ? client.invalidateQueries({
          queryKey: messagesQuery(conversationId).queryKey,
        })
      : Promise.resolve(),
    invalidateResumes(client),
    invalidateVersions(client, resumeId),
  ])
}

export async function saveWorkspaceSkill(
  client: QueryClient,
  fields: SkillDraft,
  id?: string
): Promise<string> {
  const input = UserSkillInputSchema.parse(fields)
  const saved = id
    ? await updateUserSkill({ ...input, id })
    : await createUserSkill(input)
  const detail = userSkillQuery(saved.id)
  await client.cancelQueries({ queryKey: detail.queryKey, exact: true })
  client.setQueryData(detail.queryKey, saved)
  await client.invalidateQueries({ queryKey: skillsQuery().queryKey })
  return saved.id
}

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
  infiniteQueryOptions({
    queryKey: ["resumes", "pages"] as const,
    queryFn: ({ pageParam }) => listResumePage({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })

export function useResumes(enabled = true) {
  const query = useInfiniteQuery({ ...resumesQuery(), enabled })
  const data = query.data
    ? [
        ...new Map(
          query.data.pages
            .flatMap((page) => page.items)
            .map((row) => [row.id, row])
        ).values(),
      ]
    : undefined
  return { ...query, data, total: query.data?.pages[0]?.total ?? 0 }
}
export const resumeSummaryQuery = (id: string) =>
  queryOptions({
    queryKey: ["resumes", "summary", id] as const,
    queryFn: () => getResumeSummary({ id }),
    enabled: Boolean(id),
  })
export function useResumeSummaries(ids: string[]) {
  const client = useQueryClient()
  const cached =
    client
      .getQueryData(resumesQuery().queryKey)
      ?.pages.flatMap((page) => page.items) ?? []
  return useQueries({
    queries: [...new Set(ids)].map((id) => ({
      ...resumeSummaryQuery(id),
      initialData: cached.find((row) => row.id === id),
    })),
  })
}
export async function invalidateResumes(client: QueryClient): Promise<void> {
  await client.cancelQueries({ queryKey: resumesQuery().queryKey })
  client.setQueryData(resumesQuery().queryKey, (data) =>
    data
      ? {
          pages: data.pages.slice(0, 1),
          pageParams: data.pageParams.slice(0, 1),
        }
      : data
  )
  await client.invalidateQueries({ queryKey: ["resumes"] })
}

/** The rail waits for a real word before it asks the server. */
export const SEARCH_MIN_QUERY = 2

/**
 * Rail search. The key sits under `["resumes"]` on purpose: every mutation here
 * invalidates that prefix, so a resume deleted or renamed while a query is up
 * drops out of the results without a second invalidation rule.
 */
export const searchResumesQuery = (query: string) =>
  queryOptions({
    queryKey: ["resumes", "search", query] as const,
    queryFn: () => searchResumes({ q: query }),
    enabled: query.length >= SEARCH_MIN_QUERY,
    // Keep the last results up while the next query runs: the rail is narrow
    // and a flash of skeleton on every keystroke reads as a broken list.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
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
  infiniteQueryOptions({
    queryKey: ["versions", resumeId] as const,
    queryFn: ({ pageParam }) => listVersions({ resumeId, cursor: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
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

/* --------------------------------------------------------------- skills */

/** One row of the client's library view. Bodies are not on the wire. */
export type SkillRow = Awaited<ReturnType<typeof listSkills>>[number]

/**
 * The whole library, built-ins first. One prefix covers the editor query too,
 * so a create, an edit, a delete or a toggle invalidates both with one key.
 */
export const skillsQuery = () =>
  queryOptions({
    queryKey: ["skills"] as const,
    queryFn: listSkills,
  })

/**
 * The same rows as an id-to-name map, for the places that only label a stored
 * id: a suggestion card's attribution and a turn's playbook chips. Deleted
 * rows are in the map on purpose; that is the whole reason they stay in the
 * list.
 */
export const skillNamesQuery = () =>
  queryOptions({
    queryKey: skillsQuery().queryKey,
    queryFn: listSkills,
    select: (rows: SkillRow[]): Record<string, string> =>
      Object.fromEntries(rows.map((row) => [row.id, row.name])),
  })

/** Deleted rows included: an old card still names the skill it came from. */
export function useSkillNames(): Record<string, string> {
  return useQuery(skillNamesQuery()).data ?? {}
}

/** One live custom skill with its body, for the editor. */
export const userSkillQuery = (id: string) =>
  queryOptions({
    queryKey: ["skills", id] as const,
    queryFn: () => getUserSkill({ id }),
  })

/* ------------------------------------------------------------ cache ops */

/** After anything that may have written a version: accept, save, restore. */
export async function invalidateVersions(
  queryClient: QueryClient,
  resumeId: string
): Promise<void> {
  const queryKey = versionsQuery(resumeId).queryKey
  await queryClient.cancelQueries({ queryKey })
  queryClient.setQueryData(queryKey, (data) =>
    data
      ? {
          pages: data.pages.slice(0, 1),
          pageParams: data.pageParams.slice(0, 1),
        }
      : data
  )
  await queryClient.invalidateQueries({ queryKey })
}

/* ------------------------------------------------------------ mutations */

function useResumeListMutation<TVars, TOut>(
  mutationFn: (vars: TVars) => Promise<TOut>
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateResumes(queryClient),
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
    onSuccess: () =>
      Promise.all([
        invalidateVersions(queryClient, resumeId),
        invalidateResumes(queryClient),
      ]),
  })
}

/**
 * Accepting or rejecting suggestions. Only an accept can write a version, and
 * the result says whether one did, so the list is refreshed only then.
 */
export function useDecideSuggestions(resumeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof decideSuggestions>[0]) =>
      decideResumeSuggestions(queryClient, resumeId, input),
  })
}

async function decideResumeSuggestions(
  client: QueryClient,
  resumeId: string,
  input: Parameters<typeof decideSuggestions>[0]
) {
  const result = await decideSuggestions(input)
  if (result.version)
    await Promise.all([
      invalidateVersions(client, resumeId),
      invalidateResumes(client),
    ])
  return result
}

/**
 * Clearing a conversation. The empty history is written to the cache rather
 * than invalidated: the transcript query is `staleTime: Infinity` and is only
 * read as `useChat`'s starting state, so the panel remounts onto the cache,
 * and a refetch would land after that remount had already read it.
 */
export function useClearConversation(conversationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => clearChatConversation(queryClient, conversationId),
  })
}

async function clearChatConversation(
  client: QueryClient,
  conversationId: string
) {
  const result = await clearConversation({ conversationId })
  cacheWorkspaceMessages(client, conversationId, {
    messages: [],
    suggestions: {},
  })
  return result
}

/* ------------------------------------------------------ skill mutations */

/**
 * The library prefix covers the rows and every skill detail query, so one
 * invalidation keeps the list, the chips and the editor in step.
 */
function useSkillMutation<TVars, TOut>(
  mutationFn: (vars: TVars) => Promise<TOut>
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: skillsQuery().queryKey }),
  })
}

export function useCreateUserSkill() {
  return useSkillMutation(createUserSkill)
}

export function useUpdateUserSkill() {
  return useSkillMutation(updateUserSkill)
}

export function useDeleteUserSkill() {
  return useSkillMutation((id: string) => deleteUserSkill({ id }))
}

export function useSetSkillEnabled() {
  return useSkillMutation((input: { skillId: string; disabled: boolean }) =>
    setSkillEnabled(input)
  )
}

/** Only parses the file server-side; nothing to invalidate. */
export function useImportSkillMarkdown() {
  return useMutation({ mutationFn: importSkillMarkdown })
}
