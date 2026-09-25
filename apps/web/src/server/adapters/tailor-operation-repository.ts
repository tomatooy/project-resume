import {
  AppError,
  JobIdentitySchema,
  ParsedJobPostingSchema,
  TailorOperationSchema,
  boundJob,
  type JobIdentity,
  type JobLookup,
  type OperationError,
  type ParsedJobPosting,
  type CreationCommit,
  type PreparedAdmission,
  type TailorArtifact,
  type TailorOperationRepository,
} from "@workspace/resume-core"
import { contentHash } from "@workspace/resume-schema"
import { z } from "zod"
import type { Db } from "../auth/supabase"
import { toJson } from "./json"
import { SupabaseJobTargetRepository } from "./job-target-repository"
import { SupabaseResumeRepository } from "./resume-repository"

const RowSchema = z
  .object({
    legacy: z.boolean(),
    id: z.string(),
    binding_id: z.string(),
    resume_id: z.string(),
    job_target_id: z.string(),
    attempt: z.number(),
    status: z.string(),
    expected_revision: z.number(),
    input_version_id: z.string(),
    idempotency_key: z.string(),
    deadline: z.string(),
    error_class: z.string().nullable(),
    agent_run_id: z.string().nullable(),
  })
  .transform((r) =>
    TailorOperationSchema.parse({
      legacy: r.legacy,
      id: r.id,
      bindingId: r.binding_id,
      resumeId: r.resume_id,
      jobTargetId: r.job_target_id,
      attempt: r.attempt,
      status: r.status,
      expectedRevision: r.expected_revision,
      inputVersionId: r.input_version_id,
      idempotencyKey: r.idempotency_key,
      deadline: r.deadline,
      errorClass: r.error_class,
      agentRunId: r.agent_run_id,
    })
  )

export class SupabaseTailorOperationRepository
  implements TailorOperationRepository
{
  constructor(
    private readonly db: Db,
    private readonly userId: string
  ) {}
  async lookup(identity: JobIdentity): Promise<JobLookup> {
    const read = () =>
      this.db
        .from("job_resume_bindings")
        .select("current_operation_id,resume_id")
        .eq("platform", identity.platform)
        .eq("external_job_id", identity.externalJobId)
        .maybeSingle()
    let result = await read()
    if (result.error) throw result.error
    if (!result.data) {
      const targets = await new SupabaseJobTargetRepository(
        this.db,
        this.userId
      ).findByIdentity(identity)
      if (targets.length) {
        const links = await this.db
          .from("resume_job_targets")
          .select(
            "resume_id,job_target_id,created_at,resumes!inner(deleted_at)"
          )
          .in(
            "job_target_id",
            targets.map((t) => t.id)
          )
          .eq("is_origin", true)
          .is("resumes.deleted_at", null)
          .order("created_at", { ascending: false })
          .order("resume_id", { ascending: false })
          .order("job_target_id", { ascending: false })
          .limit(1)
        if (links.error) throw links.error
        const candidate = links.data[0]
        if (candidate) {
          const resume = await new SupabaseResumeRepository(
            this.db,
            this.userId
          ).findById(candidate.resume_id)
          if (resume) {
            const adopted = await this.db.rpc("tailor_adopt", {
              p_platform: identity.platform,
              p_external_job_id: identity.externalJobId,
              p_resume_id: resume.id,
              p_content_hash: await contentHash(resume.data),
            })
            if (adopted.error) throw adopted.error
          }
        }
      }
      result = await read()
      if (result.error) throw result.error
    }
    if (!result.data?.current_operation_id) return { kind: "none" }
    const operation = await this.transition(
      result.data.current_operation_id,
      "reconcile"
    )
    const live = await this.db
      .from("resumes")
      .select("id")
      .eq("id", result.data.resume_id)
      .is("deleted_at", null)
      .maybeSingle()
    if (live.error) throw live.error
    if (!live.data) return { kind: "none" }
    return boundJob(identity, operation)
  }
  async admit(input: PreparedAdmission) {
    const { data, error } = await this.db.rpc("tailor_admit", {
      p_input: toJson(input),
    })
    if (error) throw error
    return RowSchema.parse(data)
  }
  async commitCreation(input: CreationCommit): Promise<boolean> {
    const { data, error } = await this.db.rpc("commit_tailor_creation", {
      p_input: toJson(input),
    })
    if (error) throw error
    return data
  }
  async recordModel(id: string, model: string) {
    const operation = await this.get(id)
    if (!operation.agentRunId) return
    const { error } = await this.db
      .from("agent_runs")
      .update({ model })
      .eq("id", operation.agentRunId)
    if (error) throw error
  }
  async get(id: string) {
    const { data, error } = await this.db
      .from("tailor_operations")
      .select("*")
      .eq("id", id)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new AppError("NOT_FOUND", "Attempt not found")
    return RowSchema.parse(data)
  }
  async identity(id: string) {
    const operation = await this.get(id)
    const { data, error } = await this.db
      .from("job_resume_bindings")
      .select("platform,external_job_id")
      .eq("id", operation.bindingId)
      .single()
    if (error) throw error
    return JobIdentitySchema.parse({
      platform: data.platform,
      externalJobId: data.external_job_id,
    })
  }
  private async change(id: string, action: string, payload: object = {}) {
    const { data, error } = await this.db.rpc("tailor_transition", {
      p_id: id,
      p_action: action,
      p_payload: toJson(payload),
    })
    if (error) throw error
    return RowSchema.parse(data)
  }
  transition(
    id: string,
    action: "claim" | "complete" | "cancel" | "reconcile"
  ) {
    return this.change(id, action)
  }
  fail(id: string, errorClass: OperationError) {
    return this.change(id, "fail", { errorClass })
  }
  async stage(id: string, artifact: TailorArtifact) {
    await this.change(id, "stage", artifact)
  }
  async hasArtifact(id: string) {
    const { data, error } = await this.db
      .from("tailor_operation_artifacts")
      .select("operation_id")
      .eq("operation_id", id)
      .maybeSingle()
    if (error) throw error
    return data !== null
  }
  async savePosting(id: string, posting: ParsedJobPosting) {
    const { error } = await this.db
      .from("job_targets")
      .update({
        title: posting.title,
        company: posting.company,
        location: posting.location ?? null,
        requirements: {
          mustHaves: posting.mustHaves,
          niceToHaves: posting.niceToHaves,
          keywords: posting.keywords,
        },
        parsed_at: new Date().toISOString(),
      })
      .eq("id", id)
    if (error) throw error
  }
  async parsedPosting(id: string) {
    const { data, error } = await this.db
      .from("job_targets")
      .select("title,company,location,requirements,parsed_at")
      .eq("id", id)
      .single()
    if (error) throw error
    if (!data.parsed_at) return null
    return ParsedJobPostingSchema.parse({
      title: data.title,
      company: data.company,
      location: data.location ?? undefined,
      ...z
        .object({
          mustHaves: z.array(z.string()),
          niceToHaves: z.array(z.string()),
          keywords: z.array(z.string()),
        })
        .parse(data.requirements),
    })
  }
}
