import {
  migrateResume,
  toTemplateId,
  toTemplateOptions,
  type TemplateId,
  type TemplateOptions,
} from "@workspace/resume-schema"
import {
  PAGE_SIZE,
  parseResumeCursor,
  resumeCursor,
} from "@workspace/resume-core"
import type {
  ResumePageInput,
  NewResume,
  ResumeRecord,
  ResumeRepository,
  ResumeSummary,
  UpdateDataInput,
  UpdateDataResult,
} from "@workspace/resume-core"

import type { Db } from "../auth/supabase"
import type { Database } from "@workspace/supabase"
import { toJson } from "./json"

type Row = Database["public"]["Tables"]["resumes"]["Row"]
type SummaryRow = Pick<
  Row,
  "id" | "title" | "subtitle" | "template_id" | "updated_at"
>

const RECORD_COLUMNS =
  "id,user_id,title,subtitle,data,schema_version,template_id,template_options,current_version_id,revision,created_at,updated_at,deleted_at"

const SUMMARY_COLUMNS = "id, title, subtitle, template_id, updated_at"

/**
 * `template_id` is plain text in the database so that adding a template needs
 * no migration. That freedom has to be paid for on the way out: the export and
 * preflight screens index the template map directly and white-screen on a value
 * they do not know, so an unrecognised id is coerced to the default here, in
 * the one place every read passes through.
 */
function toSummary(row: SummaryRow): ResumeSummary {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    templateId: toTemplateId(row.template_id),
    updatedAt: row.updated_at,
  }
}

function toRecord(
  row: Omit<Row, "search_text" | "search_unicode">
): ResumeRecord {
  return {
    ...toSummary(row),
    // `migrateResume` both upgrades and validates, so a `jsonb` column becomes
    // a `Resume` without a cast and without trusting what is stored.
    data: migrateResume(row.data),
    schemaVersion: row.schema_version,
    templateOptions: toTemplateOptions(row.template_options),
    currentVersionId: row.current_version_id,
    revision: row.revision,
  }
}

export class SupabaseResumeRepository implements ResumeRepository {
  constructor(
    private readonly db: Db,
    private readonly userId: string
  ) {}

  async list(): Promise<ResumeSummary[]> {
    const { data, error } = await this.db
      .from("resumes")
      .select(SUMMARY_COLUMNS)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
    if (error) throw error
    return data.map(toSummary)
  }

  async listRecords(): Promise<ResumeRecord[]> {
    const { data, error } = await this.db
      .from("resumes")
      .select(RECORD_COLUMNS)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
    if (error) throw error
    return data.map(toRecord)
  }

  async page(input: ResumePageInput) {
    const cursor = input.cursor ? parseResumeCursor(input.cursor) : null
    let query = this.db
      .from("resumes")
      .select(SUMMARY_COLUMNS, { count: cursor ? undefined : "exact" })
      .is("deleted_at", null)
    if (cursor)
      query = query.or(
        `updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`
      )
    const { data, error, count } = await query
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE + 1)
    if (error) throw error
    const items = data.slice(0, PAGE_SIZE).map(toSummary)
    const last = items.at(-1)
    return {
      items,
      nextCursor: data.length > PAGE_SIZE && last ? resumeCursor(last) : null,
      ...(!cursor ? { total: count ?? 0 } : {}),
    }
  }
  async summary(id: string) {
    const { data, error } = await this.db
      .from("resumes")
      .select(SUMMARY_COLUMNS)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle()
    if (error) throw error
    return data ? toSummary(data) : null
  }
  async count() {
    const { count, error } = await this.db
      .from("resumes")
      .select("id", { head: true, count: "exact" })
      .is("deleted_at", null)
    if (error) throw error
    return count ?? 0
  }
  async searchCandidates(
    tokens: string[],
    phase: "title" | "body",
    after?: string
  ) {
    const cursor = after ? parseResumeCursor(after) : null
    const { data, error } = await this.db
      .rpc("resume_search_candidates", {
        p_tokens: tokens,
        p_phase: phase,
        p_before_at: cursor?.updatedAt,
        p_before_id: cursor?.id,
      })
      .select(RECORD_COLUMNS)
    if (error) throw error
    const records = data.slice(0, 50).map(toRecord)
    const last = records.at(-1)
    return {
      records,
      nextCursor: data.length > 50 && last ? resumeCursor(last) : null,
    }
  }

  async findById(id: string): Promise<ResumeRecord | null> {
    const { data, error } = await this.db
      .from("resumes")
      .select(RECORD_COLUMNS)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle()
    if (error) throw error
    return data ? toRecord(data) : null
  }

  async create(input: NewResume): Promise<ResumeRecord> {
    // RLS checks `user_id = auth.uid()`, so this is the one column the client
    // must supply and the one it cannot lie about.
    const { data, error } = await this.db
      .from("resumes")
      .insert({
        user_id: this.userId,
        title: input.title,
        subtitle: input.subtitle,
        data: toJson(input.data),
        schema_version: input.schemaVersion,
        template_id: input.templateId,
        template_options: toJson(input.templateOptions),
      })
      .select(RECORD_COLUMNS)
      .single()
    if (error) throw error
    return toRecord(data)
  }

  /**
   * The guarded write. `eq('revision', expected)` makes the check and the write
   * one statement, so two tabs saving at the same moment cannot both win: the
   * loser matches no rows.
   */
  async updateData(input: UpdateDataInput): Promise<UpdateDataResult> {
    let query = this.db
      .from("resumes")
      .update({
        data: toJson(input.data),
        schema_version: input.schemaVersion,
      })
      .eq("id", input.id)
      .is("deleted_at", null)

    if (input.expectedRevision !== undefined) {
      query = query.eq("revision", input.expectedRevision)
    }

    const { data, error } = await query
      .select("revision, updated_at")
      .maybeSingle()
    if (error) throw error
    if (data) {
      return { ok: true, revision: data.revision, updatedAt: data.updated_at }
    }

    // Nothing matched, which is either a stale token or a resume that is gone.
    // The caller has to tell a 409 from a 404, so ask.
    return {
      ok: false,
      reason: (await this.exists(input.id)) ? "conflict" : "not_found",
    }
  }

  async rename(id: string, title: string): Promise<boolean> {
    return this.touch(id, { title })
  }

  async setSubtitle(id: string, subtitle: string): Promise<boolean> {
    return this.touch(id, { subtitle })
  }

  async setTemplate(
    id: string,
    templateId: TemplateId,
    options: TemplateOptions
  ): Promise<boolean> {
    return this.touch(id, {
      template_id: templateId,
      template_options: toJson(options),
    })
  }

  async softDelete(id: string): Promise<boolean> {
    return this.touch(id, { deleted_at: new Date().toISOString() })
  }

  /**
   * Metadata writes. None of them touches `data`, so the trigger leaves
   * `revision` where it is and an autosave already in flight still lands.
   */
  private async touch(
    id: string,
    patch: Database["public"]["Tables"]["resumes"]["Update"]
  ): Promise<boolean> {
    const { data, error } = await this.db
      .from("resumes")
      .update(patch)
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle()
    if (error) throw error
    return data !== null
  }

  private async exists(id: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("resumes")
      .select("id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle()
    if (error) throw error
    return data !== null
  }
}
