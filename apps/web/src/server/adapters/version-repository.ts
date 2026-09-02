import { migrateResume } from "@workspace/resume-schema"
import type {
  CreateVersionInput,
  CreateVersionResult,
  VersionRecord,
  VersionRepository,
  VersionSummary,
} from "@workspace/resume-core"
import type { z } from "zod"

import type { Db } from "../auth/supabase"
import type { Database } from "@workspace/supabase"
import { toJson } from "./json"
import { createVersionResultSchema, DEFAULT_VERSION_LABEL } from "./rpc"

type Row = Database["public"]["Tables"]["resume_versions"]["Row"]
type SummaryRow = Pick<
  Row,
  "id" | "version_no" | "label" | "created_by" | "created_at"
>

const SUMMARY_COLUMNS = "id, version_no, label, created_by, created_at"

function toSummary(row: SummaryRow): VersionSummary {
  return {
    id: row.id,
    versionNo: row.version_no,
    label: row.label ?? DEFAULT_VERSION_LABEL,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

function toSummaryFromRpc(
  row: z.infer<typeof createVersionResultSchema>["version"]
): VersionSummary {
  return {
    id: row.id,
    versionNo: row.version_no,
    label: row.label ?? DEFAULT_VERSION_LABEL,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

export class SupabaseVersionRepository implements VersionRepository {
  constructor(private readonly db: Db) {}

  async list(resumeId: string): Promise<VersionSummary[]> {
    const { data, error } = await this.db
      .from("resume_versions")
      .select(SUMMARY_COLUMNS)
      .eq("resume_id", resumeId)
      .order("version_no", { ascending: false })
    if (error) throw error
    return data.map(toSummary)
  }

  async findById(id: string): Promise<VersionRecord | null> {
    const { data, error } = await this.db
      .from("resume_versions")
      .select("*")
      .eq("id", id)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return {
      ...toSummary(data),
      resumeId: data.resume_id,
      content: migrateResume(data.content),
      contentHash: data.content_hash,
    }
  }

  /**
   * Inserting the version, moving the head, and deduping against the current
   * version all happen inside `create_resume_version`. Doing it in three
   * round-trips from here would let two callers interleave and produce two rows
   * claiming the same `version_no`.
   */
  async create(input: CreateVersionInput): Promise<CreateVersionResult> {
    const { data, error } = await this.db.rpc("create_resume_version", {
      p_resume_id: input.resumeId,
      p_content: toJson(input.content),
      p_schema_version: input.schemaVersion,
      p_content_hash: input.contentHash,
      p_label: input.label,
      p_created_by: input.createdBy,
      p_agent_run_id: input.agentRunId ?? undefined,
      p_dedupe: input.dedupe ?? true,
    })
    if (error) throw error

    const result = createVersionResultSchema.parse(data)
    return {
      version: toSummaryFromRpc(result.version),
      revision: result.revision,
      updatedAt: result.updated_at,
      deduped: result.deduped,
    }
  }
}
