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
  createRun as createRunFn,
  decideSuggestions as decideSuggestionsFn,
  getOrCreateConversation as getOrCreateConversationFn,
  saveSuggestions as saveSuggestionsFn,
} from "@/server/fns/suggestions"
import {
  createSnapshot as createSnapshotFn,
  getVersion as getVersionFn,
  listVersions as listVersionsFn,
  restoreVersion as restoreVersionFn,
} from "@/server/fns/versions"
import { ApiError } from "./types"

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
export const createRun = guard(createRunFn)
export const saveSuggestions = guard(saveSuggestionsFn)

/**
 * Accepting suggestions applies their patches to the head as it stands now and
 * records the result as a version, all in one transaction. A patch whose
 * `before` no longer matches comes back `stale` rather than being forced over
 * whatever the user typed in the meantime.
 */
export const decideSuggestions = guard(decideSuggestionsFn)

export type { Resume }
