import {
  JobTargetSchema,
  jobIdentityFromUrl,
  type JobIdentity,
} from "@workspace/resume-core"
import {
  JobRequirementsSchema,
  type JobTarget,
  type JobTargetRepository,
  type LinkJobTargetInput,
  type NewJobTarget,
} from "@workspace/resume-core"

import type { Db } from "../auth/supabase"

type Row = {
  id: string
  platform: string | null
  external_job_id: string | null
  source_url: string | null
  raw_text: string
  title: string
  company: string
  location: string | null
  requirements: unknown
  created_at: string
}

const COLUMNS =
  "id, platform, external_job_id, source_url, raw_text, title, company, location, requirements, created_at"

/** Empty rather than throwing: a posting whose requirements did not survive a
 *  schema change is still a posting, and the text is the part that matters. */
const EMPTY = { mustHaves: [], niceToHaves: [], keywords: [] }

function toJobTarget(row: Row): JobTarget {
  const parsed = JobRequirementsSchema.safeParse(row.requirements)
  return JobTargetSchema.parse({
    platform: row.platform,
    externalJobId: row.external_job_id,
    id: row.id,
    sourceUrl: row.source_url,
    rawText: row.raw_text,
    title: row.title,
    company: row.company,
    location: row.location,
    requirements: parsed.success ? parsed.data : EMPTY,
    createdAt: row.created_at,
  })
}

export class SupabaseJobTargetRepository implements JobTargetRepository {
  constructor(
    private readonly db: Db,
    private readonly userId: string
  ) {}

  async create(input: NewJobTarget): Promise<JobTarget> {
    const { data, error } = await this.db
      .from("job_targets")
      .insert({
        user_id: this.userId,
        platform: input.platform,
        external_job_id: input.externalJobId,
        parsed_at: new Date().toISOString(),
        source_url: input.sourceUrl,
        raw_text: input.rawText,
        title: input.title,
        company: input.company,
        location: input.location,
        requirements: input.requirements,
      })
      .select(COLUMNS)
      .single()

    if (error) throw error
    return toJobTarget(data)
  }

  async findByIdentity(identity: JobIdentity): Promise<JobTarget[]> {
    // Owner-scoped, idempotent backfill. Preserve every capture and association.
    const legacy = await this.db
      .from("job_targets")
      .select("id,source_url")
      .is("platform", null)
    if (legacy.error) throw legacy.error
    for (const row of legacy.data) {
      const found = row.source_url ? jobIdentityFromUrl(row.source_url) : null
      if (!found) continue
      const result = await this.db
        .from("job_targets")
        .update({
          platform: found.platform,
          external_job_id: found.externalJobId,
        })
        .eq("id", row.id)
        .is("platform", null)
      if (result.error) throw result.error
    }
    const result = await this.db
      .from("job_targets")
      .select(COLUMNS)
      .eq("platform", identity.platform)
      .eq("external_job_id", identity.externalJobId)
    if (result.error) throw result.error
    return result.data.map(toJobTarget)
  }

  async findById(id: string): Promise<JobTarget | null> {
    const { data, error } = await this.db
      .from("job_targets")
      .select(COLUMNS)
      .eq("id", id)
      .maybeSingle()

    if (error) throw error
    return data ? toJobTarget(data) : null
  }

  /** `on conflict do nothing` via upsert: relinking the same pair is a no-op. */
  async link(input: LinkJobTargetInput): Promise<void> {
    const { error } = await this.db.from("resume_job_targets").upsert(
      {
        resume_id: input.resumeId,
        job_target_id: input.jobTargetId,
        is_origin: input.isOrigin,
      },
      { onConflict: "resume_id,job_target_id", ignoreDuplicates: true }
    )
    if (error) throw error
  }

  async listForResume(resumeId: string): Promise<JobTarget[]> {
    const { data, error } = await this.db
      .from("resume_job_targets")
      .select(`job_targets (${COLUMNS})`)
      .eq("resume_id", resumeId)
      .order("created_at", { ascending: false })

    if (error) throw error
    return (data ?? [])
      .map((row) => row.job_targets)
      .filter((row) => row !== null)
      .map(toJobTarget)
  }
}
