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
  source_url: string | null
  raw_text: string
  title: string
  company: string
  location: string | null
  requirements: unknown
  created_at: string
}

const COLUMNS =
  "id, source_url, raw_text, title, company, location, requirements, created_at"

/** Empty rather than throwing: a posting whose requirements did not survive a
 *  schema change is still a posting, and the text is the part that matters. */
const EMPTY = { mustHaves: [], niceToHaves: [], keywords: [] }

function toJobTarget(row: Row): JobTarget {
  const parsed = JobRequirementsSchema.safeParse(row.requirements)
  return {
    id: row.id,
    sourceUrl: row.source_url,
    rawText: row.raw_text,
    title: row.title,
    company: row.company,
    location: row.location,
    requirements: parsed.success ? parsed.data : EMPTY,
    createdAt: row.created_at,
  }
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
