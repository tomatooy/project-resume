import {
  DiffLineSchema,
  ProfileFieldKeySchema,
  ProfileSchema,
} from "@workspace/autofill"
import { z } from "zod"

/** Why a Notes snapshot was taken (spec 8.3). */
export const NoteVersionReasonSchema = z.enum(["merge", "edit", "restore"])
export type NoteVersionReason = z.infer<typeof NoteVersionReasonSchema>

/** One History row. `length` is the snapshot's length in characters. */
export const NoteVersionSchema = z.object({
  id: z.uuid(),
  reason: NoteVersionReasonSchema,
  createdAt: z.string(),
  length: z.number().int(),
})
export type NoteVersion = z.infer<typeof NoteVersionSchema>

/** One snapshot with its text, for the History preview. */
export const NoteVersionContentSchema = NoteVersionSchema.omit({
  length: true,
}).extend({ content: z.string() })
export type NoteVersionContent = z.infer<typeof NoteVersionContentSchema>

/** The Profile page's state: the empty Profile at revision 0 before the first save. */
export const ProfileStateSchema = z.object({
  profile: ProfileSchema,
  revision: z.number().int().min(0),
  updatedAt: z.string().nullable(),
  exists: z.boolean(),
})
export type ProfileState = z.infer<typeof ProfileStateSchema>

/** The Notes and their concurrency token: revision 0 means no row yet. */
export const NotesStateSchema = z.object({
  content: z.string(),
  revision: z.number().int().min(0),
  updatedAt: z.string().nullable(),
})
export type NotesState = z.infer<typeof NotesStateSchema>

const Count = z.number().int().min(0)

/**
 * What a Notes merge did (spec 8.2): saved, with counts, a diff for Review and
 * the snapshot Undo restores; failed, which offers Retry; or full, when the
 * result would pass 10,000 characters and nothing was saved.
 */
export const NotesOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("saved"),
    added: Count,
    changed: Count,
    deleted: Count,
    undoVersionId: z.uuid().nullable(),
    revision: z.number().int(),
    diff: z.array(DiffLineSchema),
    hints: z.array(ProfileFieldKeySchema),
  }),
  z.object({ kind: z.literal("failed") }),
  z.object({ kind: z.literal("full"), hints: z.array(ProfileFieldKeySchema) }),
])
export type NotesOutcome = z.infer<typeof NotesOutcomeSchema>
