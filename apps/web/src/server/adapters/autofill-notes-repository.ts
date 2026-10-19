import {
  AppError,
  type AutofillNotesRepository,
  type NotesState,
  type NoteVersion,
  type NoteVersionContent,
  type NoteVersionReason,
} from "@workspace/resume-core"
import { z } from "zod"

import type { Db } from "../auth/supabase"

// The two RPCs return `jsonb`, parsed for the same reason as `rpc.ts`.
const savedSchema = z.object({
  revision: z.number(),
  updated_at: z.string(),
  version_id: z.string().nullable(),
})
const restoredSchema = z.object({
  revision: z.number(),
  updated_at: z.string(),
  content: z.string(),
})

const VERSION_COLUMNS = "id, reason, created_at, content"

/**
 * The RPCs lock the Notes row, check the revision, take the snapshot and
 * write in one transaction. A stale revision is `P0409` and a snapshot that
 * is missing or not the caller's is `P0002`.
 */
export class SupabaseAutofillNotesRepository
  implements AutofillNotesRepository
{
  constructor(
    private readonly db: Db,
    private readonly userId: string
  ) {}

  async get(): Promise<NotesState> {
    const { data, error } = await this.db
      .from("autofill_notes")
      .select("content, revision, updated_at")
      .eq("user_id", this.userId)
      .maybeSingle()
    if (error) throw error
    if (!data) return { content: "", revision: 0, updatedAt: null }
    return {
      content: data.content,
      revision: data.revision,
      updatedAt: data.updated_at,
    }
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
    const { data, error } = await this.db.rpc("save_autofill_notes", {
      p_content: input.content,
      p_expected_revision: input.expectedRevision,
      p_snapshot: input.snapshot ?? undefined,
    })
    if (error?.code === "P0409") throw new AppError("CONFLICT", "Notes changed")
    if (error) throw error
    const saved = savedSchema.parse(data)
    return {
      revision: saved.revision,
      updatedAt: saved.updated_at,
      versionId: saved.version_id,
    }
  }

  /** Newest first, in the order the snapshot RPC prunes by. */
  async listVersions(): Promise<NoteVersion[]> {
    const { data, error } = await this.db
      .from("autofill_note_versions")
      .select(VERSION_COLUMNS)
      .eq("user_id", this.userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
    if (error) throw error
    return data.map((row) => ({
      id: row.id,
      reason: row.reason,
      createdAt: row.created_at,
      length: row.content.length,
    }))
  }

  async findVersion(id: string): Promise<NoteVersionContent | null> {
    const { data, error } = await this.db
      .from("autofill_note_versions")
      .select(VERSION_COLUMNS)
      .eq("id", id)
      .eq("user_id", this.userId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return {
      id: data.id,
      reason: data.reason,
      createdAt: data.created_at,
      content: data.content,
    }
  }

  async restore(
    id: string,
    expectedRevision: number
  ): Promise<{ revision: number; updatedAt: string; content: string }> {
    const { data, error } = await this.db.rpc("restore_autofill_note_version", {
      p_version_id: id,
      p_expected_revision: expectedRevision,
    })
    if (error?.code === "P0409") throw new AppError("CONFLICT", "Notes changed")
    if (error?.code === "P0002") {
      throw new AppError("NOT_FOUND", "Version not found")
    }
    if (error) throw error
    const restored = restoredSchema.parse(data)
    return {
      revision: restored.revision,
      updatedAt: restored.updated_at,
      content: restored.content,
    }
  }
}
