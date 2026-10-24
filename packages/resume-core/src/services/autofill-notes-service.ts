import {
  applyNoteOps,
  diffLines,
  type NoteMergeProposal,
  NOTES_LIMIT,
  numberLines,
} from "@workspace/autofill"

import type {
  NotesOutcome,
  NotesState,
  NoteVersion,
  NoteVersionContent,
} from "../domain/autofill"
import { AppError } from "../domain/errors"
import type { AutofillNotesRepository } from "../ports/autofill-notes-repository"

/** One merge, then one rerun on the latest text after a conflict (spec 8.2). */
const MERGE_ATTEMPTS = 2

const isConflict = (error: unknown): boolean =>
  error instanceof AppError && error.code === "CONFLICT"

/** The model's proposal, or null when the call failed. */
async function proposalFor(
  propose: (numbered: string) => Promise<NoteMergeProposal>,
  content: string
): Promise<NoteMergeProposal | null> {
  try {
    return await propose(numberLines(content))
  } catch {
    return null
  }
}

/**
 * The user's Notes: manual saves from the editor, History, and the AI merge
 * with its Undo. Every write checks the revision the caller read.
 */
export class AutofillNotesService {
  constructor(private readonly notes: AutofillNotesRepository) {}

  get(): Promise<NotesState> {
    return this.notes.get()
  }

  /** `snapshot` marks the first save of an editing session (spec 8.3). */
  async save(input: {
    content: string
    expectedRevision: number
    snapshot: boolean
  }): Promise<{ revision: number; updatedAt: string }> {
    if (input.content.length > NOTES_LIMIT) {
      throw new AppError("VALIDATION", "Notes are too long")
    }
    const { revision, updatedAt } = await this.notes.save({
      content: input.content,
      expectedRevision: input.expectedRevision,
      snapshot: input.snapshot ? "edit" : null,
    })
    return { revision, updatedAt }
  }

  versions(): Promise<NoteVersion[]> {
    return this.notes.listVersions()
  }

  async version(id: string): Promise<NoteVersionContent> {
    const version = await this.notes.findVersion(id)
    if (!version) throw new AppError("NOT_FOUND", "Version not found")
    return version
  }

  async restore(input: {
    id: string
    expectedRevision: number
  }): Promise<NotesState> {
    const { content, revision, updatedAt } = await this.notes.restore(
      input.id,
      input.expectedRevision
    )
    return { content, revision, updatedAt }
  }

  /**
   * Asks the model for line operations on the numbered Notes and saves the
   * result at once, snapshotting the previous text for Undo. A result past
   * the limit is not saved; a failed call or a bad line saves nothing.
   */
  async merge(
    propose: (numbered: string) => Promise<NoteMergeProposal>
  ): Promise<NotesOutcome> {
    for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt++) {
      const current = await this.notes.get()
      const proposal = await proposalFor(propose, current.content)
      if (!proposal) return { kind: "failed" }
      const result = applyNoteOps(current.content, proposal.ops)
      if (!result.ok) return { kind: "failed" }
      if (result.content.length > NOTES_LIMIT) {
        return { kind: "full", hints: proposal.hints }
      }
      const summary = {
        added: result.added,
        changed: result.changed,
        deleted: result.deleted,
        diff: diffLines(current.content, result.content),
        hints: proposal.hints,
      }
      if (result.content === current.content) {
        return {
          kind: "saved",
          ...summary,
          undoVersionId: null,
          revision: current.revision,
        }
      }
      try {
        const written = await this.notes.save({
          content: result.content,
          expectedRevision: current.revision,
          snapshot: "merge",
        })
        return {
          kind: "saved",
          ...summary,
          undoVersionId: written.versionId,
          revision: written.revision,
        }
      } catch (error) {
        if (!isConflict(error)) throw error
      }
    }
    return { kind: "failed" }
  }

  /** Restores the snapshot a merge took, unless the Notes changed since. */
  async undo(input: {
    versionId: string
    revision: number
  }): Promise<{ kind: "restored"; revision: number } | { kind: "changed" }> {
    try {
      const { revision } = await this.notes.restore(
        input.versionId,
        input.revision
      )
      return { kind: "restored", revision }
    } catch (error) {
      if (isConflict(error)) return { kind: "changed" }
      throw error
    }
  }
}
