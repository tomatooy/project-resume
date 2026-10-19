import { NOTES_LIMIT } from "@workspace/autofill"
import type { NoteVersionReason } from "@workspace/resume-core"

import type { SaveResult } from "@/features/resume/auto-saver"
import { ApiError } from "@/lib/types"

/** This long without a save, and the next save starts a new session. */
const SESSION_GAP_MS = 30 * 60_000

export type EditSession = {
  /** Whether the next save should keep a copy of the text it replaces. */
  needsSnapshot(): boolean
  /** Records a save, which keeps the session going. */
  saved(): void
}

/**
 * One stretch of editing the Notes by hand. Its first save keeps a copy of the
 * text it replaces, so History can bring that text back; later saves do not,
 * until 30 minutes pass without a save and the next one starts a new session.
 */
export function createEditSession(now: () => number): EditSession {
  let last: number | null = null
  return {
    needsSnapshot: () => last === null || now() - last >= SESSION_GAP_MS,
    saved: () => {
      last = now()
    },
  }
}

const NUMBER = new Intl.NumberFormat("en-US")

/** "1,234 / 10,000". */
export function notesCount(length: number): string {
  return `${NUMBER.format(length)} / ${NUMBER.format(NOTES_LIMIT)}`
}

/** "1,234 characters". */
export function characters(length: number): string {
  return `${NUMBER.format(length)} ${length === 1 ? "character" : "characters"}`
}

/** Why History kept each version. */
export const REASON_LABELS: Record<NoteVersionReason, string> = {
  merge: "Before notes update",
  edit: "Before editing",
  restore: "Before restore",
}

/**
 * One autosave write of the Notes. The session decides whether the server
 * keeps a copy of the old text first, and only a save that went through counts
 * towards the session. A stale revision stops the saver and asks for the
 * latest notes; anything else is retried.
 */
export function notesWriter(deps: {
  read: () => { content: string; revision: number }
  save: (input: {
    content: string
    expectedRevision: number
    snapshot: boolean
  }) => Promise<{ revision: number; updatedAt: string }>
  session: EditSession
  onSaved: (revision: number) => void
  onConflict: () => void
}): () => Promise<SaveResult> {
  return async () => {
    const { content, revision } = deps.read()
    try {
      const saved = await deps.save({
        content,
        expectedRevision: revision,
        snapshot: deps.session.needsSnapshot(),
      })
      deps.session.saved()
      deps.onSaved(saved.revision)
      return "ok"
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        deps.onConflict()
        return "conflict"
      }
      return "retry"
    }
  }
}
