import {
  applyPatches,
  migrateResume,
  regenerateIds,
  ResumeSchema,
  type Resume,
} from "@workspace/resume-schema"
import {
  defaultTemplateOptions,
  type TemplateId,
  type TemplateOptions,
} from "@workspace/resume-render"

import {
  blankResume,
  nextId,
  read,
  resetStore,
  snapshot,
  write,
  type StoredMessage,
} from "./mock-store"
import {
  ApiError,
  type DecideResult,
  type ResumeRecord,
  type ResumeSummary,
  type Suggestion,
  type SuggestionStatus,
  type VersionSummary,
} from "./types"

/**
 * The application's data layer.
 *
 * Each function mirrors the signature of the server function in back-end spec
 * section 4. Today they run against the local mock store; when the Worker
 * lands, each body becomes a `createServerFn(...)` call and nothing above this
 * module changes.
 */

const summary = (r: ResumeRecord): ResumeSummary => ({
  id: r.id,
  title: r.title,
  subtitle: r.subtitle,
  templateId: r.templateId,
  updatedAt: r.updatedAt,
})

function requireResume(id: string): ResumeRecord {
  const found = read().resumes.find((r) => r.id === id)
  if (!found) throw new ApiError("NOT_FOUND", `No resume ${id}`, 404)
  return found
}

const touch = (r: ResumeRecord) => {
  r.updatedAt = new Date().toISOString()
  return r.updatedAt
}

/* -------------------------------------------------------------- resumes */

export async function listResumes(): Promise<ResumeSummary[]> {
  return read()
    .resumes.map(summary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getResume(input: { id: string }): Promise<ResumeRecord> {
  const found = requireResume(input.id)
  return { ...found, data: migrateResume(found.data) }
}

export async function createResume(input: {
  title?: string
  fromResumeId?: string
}): Promise<ResumeSummary> {
  return write((store) => {
    const source = input.fromResumeId
      ? store.resumes.find((r) => r.id === input.fromResumeId)
      : undefined

    const record: ResumeRecord = {
      id: nextId("r"),
      title:
        input.title ?? (source ? `${source.title} copy` : "Untitled resume"),
      subtitle: source ? source.subtitle : "Draft · not tailored",
      templateId: source?.templateId ?? "lisbon",
      updatedAt: new Date().toISOString(),
      data: source ? regenerateIds(source.data) : blankResume(),
      schemaVersion: 1,
      templateOptions: source?.templateOptions ?? defaultTemplateOptions,
      currentVersionId: null,
    }
    store.resumes.unshift(record)
    return summary(record)
  })
}

export async function updateResume(input: {
  id: string
  data: Resume
  expectedUpdatedAt?: string
}): Promise<{ updatedAt: string }> {
  const parsed = ResumeSchema.safeParse(input.data)
  if (!parsed.success) {
    throw new ApiError(
      "VALIDATION",
      parsed.error.issues[0]?.message ?? "Invalid",
      400
    )
  }
  return write((store) => {
    const record = store.resumes.find((r) => r.id === input.id)
    if (!record) throw new ApiError("NOT_FOUND", `No resume ${input.id}`, 404)
    if (
      input.expectedUpdatedAt &&
      input.expectedUpdatedAt !== record.updatedAt
    ) {
      throw new ApiError("CONFLICT", "This resume changed in another tab", 409)
    }
    record.data = parsed.data
    return { updatedAt: touch(record) }
  })
}

export async function renameResume(input: {
  id: string
  title: string
}): Promise<{ ok: true }> {
  return write((store) => {
    const record = store.resumes.find((r) => r.id === input.id)
    if (!record) throw new ApiError("NOT_FOUND", `No resume ${input.id}`, 404)
    record.title = input.title.trim() || "Untitled resume"
    // Deliberately not `touch`: see the note on `setTemplate`.
    return { ok: true as const }
  })
}

export async function setTemplate(input: {
  id: string
  templateId: TemplateId
  templateOptions: TemplateOptions
}): Promise<{ ok: true }> {
  return write((store) => {
    const record = store.resumes.find((r) => r.id === input.id)
    if (!record) throw new ApiError("NOT_FOUND", `No resume ${input.id}`, 404)
    record.templateId = input.templateId
    record.templateOptions = input.templateOptions
    // Deliberately not `touch`. `updatedAt` doubles as the optimistic
    // concurrency token that `updateResume` checks `expectedUpdatedAt`
    // against, and these two functions return `{ ok: true }`, so the client
    // has no way to learn a new value. Moving it here would make the next
    // autosave after a rename or a template change fail as a conflict the
    // user never caused. Only document writes move the token.
    return { ok: true as const }
  })
}

export async function duplicateResume(input: {
  id: string
}): Promise<ResumeSummary> {
  return createResume({ fromResumeId: input.id })
}

export async function deleteResume(input: {
  id: string
}): Promise<{ ok: true }> {
  return write((store) => {
    store.resumes = store.resumes.filter((r) => r.id !== input.id)
    store.versions = store.versions.filter((v) => v.resumeId !== input.id)
    return { ok: true as const }
  })
}

/* ------------------------------------------------------------- versions */

export async function listVersions(input: {
  resumeId: string
}): Promise<VersionSummary[]> {
  return read()
    .versions.filter((v) => v.resumeId === input.resumeId)
    .sort((a, b) => b.versionNo - a.versionNo)
    .map(({ id, versionNo, label, createdBy, createdAt }) => ({
      id,
      versionNo,
      label,
      createdBy,
      createdAt,
    }))
}

export async function getVersion(input: {
  id: string
}): Promise<{ content: Resume }> {
  const found = read().versions.find((v) => v.id === input.id)
  if (!found) throw new ApiError("NOT_FOUND", `No version ${input.id}`, 404)
  return { content: found.content }
}

export async function createSnapshot(input: {
  resumeId: string
  label?: string
}): Promise<VersionSummary> {
  const store = read()
  const version = await snapshot(
    store,
    input.resumeId,
    input.label ?? "Saved version",
    "user"
  )
  if (!version)
    throw new ApiError("NOT_FOUND", `No resume ${input.resumeId}`, 404)
  write(() => undefined)
  const { id, versionNo, label, createdBy, createdAt } = version
  return { id, versionNo, label, createdBy, createdAt }
}

export async function restoreVersion(input: {
  resumeId: string
  versionId: string
}): Promise<{ head: Resume; updatedAt: string; version: VersionSummary }> {
  const store = read()
  const target = store.versions.find((v) => v.id === input.versionId)
  const record = store.resumes.find((r) => r.id === input.resumeId)
  if (!target || !record)
    throw new ApiError("NOT_FOUND", "Version not found", 404)

  record.data = structuredClone(target.content)
  const created = await snapshot(
    store,
    input.resumeId,
    `Restored from v${target.versionNo}`,
    "user"
  )
  const updatedAt = touch(record)
  write(() => undefined)
  if (!created) throw new ApiError("INTERNAL", "Could not snapshot", 500)
  const { id, versionNo, label, createdBy, createdAt } = created
  return {
    head: record.data,
    updatedAt,
    version: { id, versionNo, label, createdBy, createdAt },
  }
}

/* -------------------------------------------------------- conversations */

export async function getOrCreateConversation(input: {
  resumeId: string
}): Promise<{ id: string }> {
  return write((store) => {
    const existing = store.conversations.find(
      (c) => c.resumeId === input.resumeId
    )
    if (existing) return { id: existing.id }
    const created = { id: nextId("conv"), resumeId: input.resumeId }
    store.conversations.push(created)
    return { id: created.id }
  })
}

export async function listMessages(input: {
  conversationId: string
  limit?: number
}): Promise<StoredMessage[]> {
  return read()
    .messages.filter((m) => m.conversationId === input.conversationId)
    .sort((a, b) => a.seq - b.seq)
    .slice(-(input.limit ?? 100))
}

export async function appendMessage(
  message: Omit<StoredMessage, "id" | "seq">
): Promise<StoredMessage> {
  return write((store) => {
    const seq =
      store.messages.filter((m) => m.conversationId === message.conversationId)
        .length + 1
    const stored: StoredMessage = { ...message, id: nextId("msg"), seq }
    store.messages.push(stored)
    return stored
  })
}

/* --------------------------------------------------------- suggestions */

export async function saveSuggestions(
  suggestions: Suggestion[]
): Promise<Suggestion[]> {
  return write((store) => {
    store.suggestions.push(...suggestions)
    return suggestions
  })
}

export async function listSuggestions(runId: string): Promise<Suggestion[]> {
  return read().suggestions.filter((s) => s.runId === runId)
}

/**
 * Accepting suggestions applies their patches to the head and snapshots the
 * result, which is the only way a version is created by the agent. Patches that
 * no longer match the document come back as `stale` rather than being forced.
 */
export async function decideSuggestions(input: {
  resumeId: string
  runId: string
  decisions: { suggestionId: string; status: "accepted" | "rejected" }[]
}): Promise<DecideResult> {
  const store = read()
  const record = store.resumes.find((r) => r.id === input.resumeId)
  if (!record)
    throw new ApiError("NOT_FOUND", `No resume ${input.resumeId}`, 404)

  const results: { suggestionId: string; status: SuggestionStatus }[] = []
  const accepting: Suggestion[] = []

  for (const decision of input.decisions) {
    const suggestion = store.suggestions.find(
      (s) => s.id === decision.suggestionId
    )
    if (!suggestion) continue
    if (decision.status === "rejected") {
      suggestion.status = "rejected"
      results.push({ suggestionId: suggestion.id, status: "rejected" })
      continue
    }
    accepting.push(suggestion)
  }

  if (accepting.length > 0) {
    const applied = applyPatches(
      record.data,
      accepting.map((s) => s.patch)
    )
    record.data = applied.resume

    const failedPatches = new Set(applied.failed.map((f) => f.patch))
    for (const suggestion of accepting) {
      const stale = failedPatches.has(suggestion.patch)
      suggestion.status = stale ? "stale" : "accepted"
      results.push({
        suggestionId: suggestion.id,
        status: stale ? "stale" : "accepted",
      })
    }
  }

  const accepted = results.some((r) => r.status === "accepted")
  const version = accepted
    ? await snapshot(store, input.resumeId, "AI suggestions accepted", "agent")
    : undefined
  const updatedAt = touch(record)
  write(() => undefined)

  return {
    head: record.data,
    updatedAt,
    version: version
      ? {
          id: version.id,
          versionNo: version.versionNo,
          label: version.label,
          createdBy: version.createdBy,
          createdAt: version.createdAt,
        }
      : undefined,
    results,
  }
}

/* ------------------------------------------------------------- session */

export async function getSession(): Promise<{
  userId: string
  email: string
} | null> {
  // Auth is not wired to Supabase yet; the console runs as a single demo user.
  return { userId: "demo-user", email: "maya@chandra.design" }
}

export { resetStore }
