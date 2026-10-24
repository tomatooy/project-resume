import type { AutofillVendor } from "@workspace/autofill"
import type {
  AutofillApplicationInput,
  AutofillApplicationRecord,
  AutofillApplicationRepository,
  Counts,
} from "@workspace/resume-core"

import type { Db } from "../auth/supabase"
import { toJson } from "./json"

/** One record per posting the user filled, keyed by (user, vendor, posting key). */
export class SupabaseAutofillApplicationRepository
  implements AutofillApplicationRepository
{
  constructor(
    private readonly db: Db,
    private readonly userId: string
  ) {}

  async upsert(input: AutofillApplicationInput): Promise<{ id: string }> {
    const { data, error } = await this.db
      .from("autofill_applications")
      .upsert(
        {
          user_id: this.userId,
          vendor: input.vendor,
          posting_key: input.postingKey,
          org_slug: input.orgSlug,
          url: input.url,
          company: input.company,
          title: input.title,
          resume_id: input.resumeId,
          resume_version_id: input.resumeVersionId,
          job_target_id: input.jobTargetId,
        },
        { onConflict: "user_id,vendor,posting_key" }
      )
      .select("id")
      .single()
    if (error) throw error
    return { id: data.id }
  }

  /** A soft-deleted resume still names itself: the line says what filled it then. */
  async find(
    vendor: AutofillVendor,
    postingKey: string
  ): Promise<AutofillApplicationRecord | null> {
    const { data, error } = await this.db
      .from("autofill_applications")
      .select("id, updated_at, resume_id, resumes(title)")
      .eq("user_id", this.userId)
      .eq("vendor", vendor)
      .eq("posting_key", postingKey)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return {
      id: data.id,
      updatedAt: data.updated_at,
      resumeId: data.resume_id,
      resumeTitle: data.resumes?.title ?? null,
    }
  }

  async latestResumeId(): Promise<string | null> {
    const { data, error } = await this.db
      .from("autofill_applications")
      .select("resume_id, resumes!inner(deleted_at)")
      .eq("user_id", this.userId)
      .is("resumes.deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
    if (error) throw error
    return data[0]?.resume_id ?? null
  }

  async updateCounts(id: string, counts: Counts): Promise<void> {
    const { error } = await this.db
      .from("autofill_applications")
      .update({ counts: toJson(counts) })
      .eq("id", id)
    if (error) throw error
  }
}
