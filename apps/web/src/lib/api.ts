import type { ResumeSummary } from "@workspace/resume-core"
import type { Resume } from "@workspace/resume-schema"

import {
  createResume as createResumeFn,
  deleteResume as deleteResumeFn,
  duplicateResume as duplicateResumeFn,
  getResume as getResumeFn,
  listResumes as listResumesFn,
  renameResume as renameResumeFn,
  setTemplate as setTemplateFn,
  updateResume as updateResumeFn,
} from "@/server/fns/resumes"
import {
  clearConversation as clearConversationFn,
  getOrCreateConversation as getOrCreateConversationFn,
} from "@/server/fns/conversations"
import { importResume as importResumeFn } from "@/server/fns/import"
import {
  fetchJobPosting as fetchJobPostingFn,
  tailorFromJob as tailorFromJobFn,
} from "@/server/fns/jobs"
import { decideSuggestions as decideSuggestionsFn } from "@/server/fns/suggestions"
import {
  createSnapshot as createSnapshotFn,
  getVersion as getVersionFn,
  listVersions as listVersionsFn,
  restoreVersion as restoreVersionFn,
} from "@/server/fns/versions"
import { ApiError, type ChatHistory, type TailorFromJobResult } from "./types"

/**
 * The application's data layer: one thin wrapper per server function.
 *
 * The wrappers exist for one reason, and it is not tidiness. An error thrown on
 * the server arrives here as a plain `Error` with the original `code` copied
 * onto it, not as the class that was thrown. Without rebuilding an `ApiError`,
 * the conflict check in `store.ts` never matches, every 409 falls through to
 * the retry branch, and the editor retries a save that can never succeed while
 * the conflict banner never appears.
 */

const CODES = [
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION",
  "RATE_LIMITED",
  "INTERNAL",
] as const

type Code = (typeof CODES)[number]

function codeOf(error: unknown): Code | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null
  }
  const { code } = error
  return CODES.find((known) => known === code) ?? null
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error

  const code = codeOf(error)
  const message =
    error instanceof Error && error.message
      ? error.message
      : "Something went wrong"

  if (code) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 500
    return new ApiError(code, message, status)
  }

  return new ApiError("INTERNAL", message, 500)
}

/** Wraps a server function that takes an argument. */
function guard<TIn, TOut>(
  fn: (opts: { data: TIn }) => Promise<TOut>
): (input: TIn) => Promise<TOut> {
  return async (input) => {
    try {
      return await fn({ data: input })
    } catch (error) {
      throw toApiError(error)
    }
  }
}

/** Wraps a server function that takes none. */
function guardNullary<TOut>(fn: () => Promise<TOut>): () => Promise<TOut> {
  return async () => {
    try {
      return await fn()
    } catch (error) {
      throw toApiError(error)
    }
  }
}

/* -------------------------------------------------------------- resumes */

export const listResumes = guardNullary(listResumesFn)
export const getResume = guard(getResumeFn)
export const createResume = guard(createResumeFn)
export const duplicateResume = guard(duplicateResumeFn)
export const deleteResume = guard(deleteResumeFn)
export const renameResume = guard(renameResumeFn)
export const setTemplate = guard(setTemplateFn)

/**
 * Reads plain text into a new resume. The file never leaves the browser: the
 * PDF is turned into text there, so this call carries a string.
 *
 * Written out rather than wrapped in `guard` because it is the one call the
 * user can cancel, and `guard` has nowhere to put the signal.
 */
export async function importResume(
  input: { text: string },
  signal?: AbortSignal
): Promise<ResumeSummary> {
  try {
    return await importResumeFn({ data: input, signal })
  } catch (error) {
    throw toApiError(error)
  }
}

/**
 * Fetches a LinkedIn posting so the user can read it before generating. The
 * text lands in the textarea, which is the confirmation step: nothing is
 * generated from something the user has not seen.
 */
export async function fetchJobPosting(
  input: { url: string },
  signal?: AbortSignal
): Promise<{ url: string; text: string }> {
  try {
    return await fetchJobPostingFn({ data: input, signal })
  } catch (error) {
    throw toApiError(error)
  }
}

/**
 * Creates a resume from a posting. Resolves with `tailored: false` rather than
 * rejecting when the writing call fails: the user still has a resume, and the
 * dialog says which one they got.
 */
export async function tailorFromJob(
  input: { sourceResumeId: string; jobText: string; sourceUrl?: string },
  signal?: AbortSignal
): Promise<TailorFromJobResult> {
  try {
    return await tailorFromJobFn({ data: input, signal })
  } catch (error) {
    throw toApiError(error)
  }
}

/**
 * `expectedRevision` is the optimistic-concurrency token, and it is a
 * `revision` rather than `updatedAt` on purpose: renaming a resume or switching
 * its template moves the timestamp but not the token, so neither turns the next
 * autosave into a conflict the user never caused.
 *
 * Omitting it means "take mine regardless", which is what the conflict banner's
 * Keep mine button does.
 */
export const updateResume = guard(updateResumeFn)

/* ------------------------------------------------------------- versions */

export const listVersions = guard(listVersionsFn)
export const getVersion = guard(getVersionFn)
export const createSnapshot = guard(createSnapshotFn)
export const restoreVersion = guard(restoreVersionFn)

/* -------------------------------------------------- conversations, runs */

export const getOrCreateConversation = guard(getOrCreateConversationFn)

/** Forgets the conversation: transcript and memory, never the resume. */
export const clearConversation = guard(clearConversationFn)

/**
 * Rebuilds an `ApiError` from the JSON the chat route answers with when it
 * refuses a request. `useChat` surfaces that body as the error's message, so
 * the same parser serves both the history fetch and the stream.
 */
export function apiErrorFromBody(text: string, status: number): ApiError {
  try {
    const parsed: unknown = JSON.parse(text)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof parsed.error === "object" &&
      parsed.error !== null &&
      "message" in parsed.error &&
      typeof parsed.error.message === "string"
    ) {
      const code = codeOf(parsed.error) ?? "INTERNAL"
      return new ApiError(code, parsed.error.message, status)
    }
  } catch {
    // Not JSON: fall through to the generic error.
  }
  return new ApiError("INTERNAL", "Something went wrong", status)
}

/**
 * The stored conversation, as `useChat` expects to receive it, plus the
 * current status of every suggestion card in it. Fetched from the chat route
 * rather than a server function because patches carry `unknown` fields that
 * the server-function serializer refuses.
 */
export async function listMessages(
  conversationId: string
): Promise<ChatHistory> {
  const params = new URLSearchParams({ conversationId })
  const response = await fetch(`/api/chat?${params}`, {
    credentials: "same-origin",
  })
  if (!response.ok) {
    throw apiErrorFromBody(await response.text(), response.status)
  }
  const history: ChatHistory = await response.json()
  return history
}

/**
 * Accepting suggestions applies their patches to the head as it stands now and
 * records the result as a version, all in one transaction. A patch whose
 * `before` no longer matches comes back `stale` rather than being forced over
 * whatever the user typed in the meantime.
 */
export const decideSuggestions = guard(decideSuggestionsFn)

export type { Resume }
