import { NOTE_VERSIONS_KEPT } from "@workspace/autofill"

import type {
  NotesState,
  NoteVersion,
  NoteVersionContent,
  NoteVersionReason,
} from "../domain/autofill"
import { AppError } from "../domain/errors"
import type { AutofillNotesRepository } from "../ports/autofill-notes-repository"
import {
  type AutofillNotesRow,
  type InMemoryDb,
  type NoteVersionRow,
  nowIso,
} from "./db"

/**
 * Mirrors `save_autofill_notes` and `restore_autofill_note_version`: the
 * revision moves only when the text does, a snapshot equal to the latest one
 * is reused, only the newest 20 are kept, and a restore snapshots the current
 * text with reason `restore` first.
 */
export class InMemoryAutofillNotesRepository
  implements AutofillNotesRepository
{
  constructor(private readonly db: InMemoryDb) {}

  async get(): Promise<NotesState> {
    const row = this.db.autofillNotes
    return row ? { ...row } : { content: "", revision: 0, updatedAt: null }
  }

  async save(input: {
    content: string
    expectedRevision: number
    snapshot: NoteVersionReason | null
  }): Promise<{
    revision: number
    updatedAt: string
    versionId: string | null
  }> {
    const row = this.lock(input.expectedRevision)
    if (row && row.content === input.content) {
      return {
        revision: row.revision,
        updatedAt: row.updatedAt,
        versionId: null,
      }
    }
    const versionId =
      input.snapshot === null
        ? null
        : this.snapshot(row?.content ?? "", input.snapshot)
    const written = this.write(input.content)
    return {
      revision: written.revision,
      updatedAt: written.updatedAt,
      versionId,
    }
  }

  async listVersions(): Promise<NoteVersion[]> {
    return this.newestFirst().map(({ id, reason, createdAt, content }) => ({
      id,
      reason,
      createdAt,
      length: content.length,
    }))
  }

  async findVersion(id: string): Promise<NoteVersionContent | null> {
    const version = this.db.noteVersions.find((row) => row.id === id)
    return version ? { ...version } : null
  }

  async restore(
    id: string,
    expectedRevision: number
  ): Promise<{ revision: number; updatedAt: string; content: string }> {
    const row = this.lock(expectedRevision)
    const version = this.db.noteVersions.find((each) => each.id === id)
    if (!version) throw new AppError("NOT_FOUND", "Version not found")
    this.snapshot(row?.content ?? "", "restore")
    const written = this.write(version.content)
    return { ...written }
  }

  /** The row, after the revision check the SQL makes under its row lock. */
  private lock(expectedRevision: number): AutofillNotesRow | null {
    const row = this.db.autofillNotes
    if ((row?.revision ?? 0) !== expectedRevision) {
      throw new AppError("CONFLICT", "Notes changed")
    }
    return row
  }

  private snapshot(content: string, reason: NoteVersionReason): string {
    const [latest] = this.newestFirst()
    if (latest && latest.content === content) return latest.id
    const id = this.db.uuid()
    this.db.noteVersions.push({
      id,
      content,
      reason,
      createdAt: nowIso(this.db),
    })
    const kept = new Set(
      this.newestFirst()
        .slice(0, NOTE_VERSIONS_KEPT)
        .map((version) => version.id)
    )
    this.db.noteVersions = this.db.noteVersions.filter((version) =>
      kept.has(version.id)
    )
    return id
  }

  private write(content: string): AutofillNotesRow {
    const row = this.db.autofillNotes
    if (!row) {
      const created = { content, revision: 1, updatedAt: nowIso(this.db) }
      this.db.autofillNotes = created
      return created
    }
    if (row.content !== content) {
      row.content = content
      row.revision += 1
      row.updatedAt = nowIso(this.db)
    }
    return row
  }

  private newestFirst(): NoteVersionRow[] {
    return [...this.db.noteVersions].sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
    )
  }
}
