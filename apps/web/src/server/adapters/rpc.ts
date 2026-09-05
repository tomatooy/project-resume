import type { VersionSummary } from "@workspace/resume-core"
import { z } from "zod"

/**
 * The two RPCs return `jsonb`, which reaches TypeScript as `Json`. Parsing the
 * payload here rather than casting it means a change to the SQL that the
 * generated types cannot see, such as a renamed key, fails loudly on the first
 * call instead of surfacing as `undefined` three layers up.
 */

const versionRowSchema = z.object({
  id: z.string(),
  resume_id: z.string(),
  version_no: z.number(),
  content_hash: z.string(),
  label: z.string().nullable(),
  created_by: z.enum(["user", "agent", "system"]),
  created_at: z.string(),
})

export const createVersionResultSchema = z.object({
  version: versionRowSchema,
  revision: z.number(),
  updated_at: z.string(),
  deduped: z.boolean(),
})

export const decideResultSchema = z.object({
  version: versionRowSchema.nullable(),
  revision: z.number(),
  updated_at: z.string(),
})

/**
 * `label` is nullable in the schema, but every writer in this application
 * supplies one. The fallback only covers a row written by hand.
 */
const DEFAULT_VERSION_LABEL = "Saved version"

/** The columns a summary is built from, in the table's own names. */
export type VersionSummaryRow = Pick<
  z.infer<typeof versionRowSchema>,
  "id" | "version_no" | "label" | "created_by" | "created_at"
>

/**
 * A version summary arrives three ways, as a listed row, a fetched row, and
 * the row an RPC hands back, and the same five columns are read each time.
 */
export function toVersionSummary(row: VersionSummaryRow): VersionSummary {
  return {
    id: row.id,
    versionNo: row.version_no,
    label: row.label ?? DEFAULT_VERSION_LABEL,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}
