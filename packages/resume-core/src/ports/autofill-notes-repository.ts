import type {
  NotesState,
  NoteVersion,
  NoteVersionContent,
  NoteVersionReason,
} from "../domain/autofill"

/**
 * The caller's Notes and their snapshots. Expected revision 0 means "no row
 * yet"; a mismatch throws `AppError("CONFLICT", "Notes changed")`, and an
 * unknown snapshot throws `AppError("NOT_FOUND", "Version not found")`.
 */
export interface AutofillNotesRepository {
  /** Empty text at revision 0, with no time, before the first save. */
  get(): Promise<NotesState>
  /**
   * Writing the same text changes nothing and returns no version id. With a
   * reason, the previous text is snapshotted first, unless the latest
   * snapshot already holds it; either way that snapshot's id comes back.
   */
  save(input: {
    content: string
    expectedRevision: number
    snapshot: NoteVersionReason | null
  }): Promise<{ revision: number; updatedAt: string; versionId: string | null }>
  /** The kept snapshots, newest first. */
  listVersions(): Promise<NoteVersion[]>
  findVersion(id: string): Promise<NoteVersionContent | null>
  /** Snapshots the current text with reason `restore`, then writes the snapshot's text. */
  restore(
    id: string,
    expectedRevision: number
  ): Promise<{ revision: number; updatedAt: string; content: string }>
}
