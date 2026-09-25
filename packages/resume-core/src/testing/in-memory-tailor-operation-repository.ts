import { AppError } from "../domain/errors"
import type { JobIdentity } from "../domain/job-identity"
import type { ParsedJobPosting } from "../domain/job-target"
import {
  ATTEMPT_MS,
  boundJob,
  isActive,
  type TailorOperation,
  type JobLookup,
  type OperationError,
} from "../domain/tailor-operation"
import type {
  CreationCommit,
  PreparedAdmission,
  TailorArtifact,
  TailorOperationRepository,
} from "../ports/tailor-operation-repository"
import type { InMemoryDb } from "./db"
import { InMemoryResumeRepository } from "./in-memory-resume-repository"
import { InMemoryVersionRepository } from "./in-memory-version-repository"
import { InMemoryAgentRunRepository } from "./in-memory-agent-run-repository"

export class InMemoryTailorOperationRepository
  implements TailorOperationRepository
{
  readonly rows: TailorOperation[] = []
  readonly bindings = new Map<
    string,
    { identity: JobIdentity; operationId: string }
  >()
  readonly artifacts = new Map<string, TailorArtifact>()
  readonly postings = new Map<string, ParsedJobPosting>()
  private pending: Promise<void> = Promise.resolve()
  constructor(private readonly db: InMemoryDb) {}
  private async locked<T>(work: () => Promise<T>): Promise<T> {
    const before = this.pending
    let release = () => {}
    this.pending = new Promise<void>((resolve) => {
      release = resolve
    })
    await before
    try {
      return await work()
    } finally {
      release()
    }
  }
  async lookup(identity: JobIdentity): Promise<JobLookup> {
    const binding = this.bindings.get(identity.externalJobId)
    if (!binding) return { kind: "none" }
    const operation = await this.transition(binding.operationId, "reconcile")
    if (
      !this.db.resumes.some((r) => r.id === operation.resumeId && !r.deletedAt)
    ) {
      await this.fail(operation.id, "deleted")
      return { kind: "none" }
    }
    return boundJob(identity, operation)
  }
  async commitCreation(input: CreationCommit): Promise<boolean> {
    return this.locked(async () => {
      const resume = this.db.resumes.find(
        (r) => r.id === input.resumeId && !r.deletedAt
      )
      const run = this.db.runs.find(
        (r) => r.id === input.runId && r.resumeId === input.resumeId
      )
      if (
        !resume ||
        !run ||
        run.status !== "running" ||
        resume.revision !== input.expectedRevision
      )
        return false
      await new InMemoryVersionRepository(this.db).create({
        resumeId: input.resumeId,
        content: input.document,
        schemaVersion: 1,
        contentHash: input.contentHash,
        label: input.label,
        createdBy: "system",
        agentRunId: input.runId,
      })
      resume.subtitle = input.subtitle
      run.status = "completed"
      run.model = input.model
      run.latencyMs = input.latencyMs
      return true
    })
  }
  async recordModel(id: string, model: string) {
    const operation = await this.get(id)
    const run = this.db.runs.find((r) => r.id === operation.agentRunId)
    if (run) run.model = model
  }
  async get(id: string): Promise<TailorOperation> {
    const row = this.rows.find((r) => r.id === id)
    if (!row) throw new AppError("NOT_FOUND", "Attempt not found")
    return structuredClone(row)
  }
  async identity(id: string): Promise<JobIdentity> {
    const row = await this.get(id)
    const binding = [...this.bindings.values()].find((b) =>
      this.rows.some(
        (o) => o.id === b.operationId && o.bindingId === row.bindingId
      )
    )
    if (!binding) throw new AppError("NOT_FOUND", "Binding not found")
    return binding.identity
  }
  admit(input: PreparedAdmission): Promise<TailorOperation> {
    return this.locked(async () => {
      const replay = this.rows.find(
        (r) => r.idempotencyKey === input.idempotencyKey
      )
      if (replay) {
        if (
          (await this.identity(replay.id)).externalJobId !== input.externalJobId
        )
          throw new AppError("CONFLICT", "Key already used")
        return structuredClone(replay)
      }
      const previous = this.bindings.get(input.externalJobId)
      const old = previous ? await this.get(previous.operationId) : null
      const live =
        old &&
        this.db.resumes.some((r) => r.id === old.resumeId && !r.deletedAt)
      const retry = "expectedOperationId" in input
      if (live && !retry && old) return old
      if (
        retry &&
        (!old ||
          !live ||
          old.id !== input.expectedOperationId ||
          (old.status !== "failed" && old.status !== "cancelled"))
      )
        throw new AppError("CONFLICT", "Attempt changed")
      if (
        this.db.runs.filter(
          (r) => Date.parse(r.createdAt) > this.db.now().getTime() - 3_600_000
        ).length >= 60
      )
        throw new AppError("RATE_LIMITED", "Hourly AI limit")
      const resumes = new InMemoryResumeRepository(this.db)
      const source = await resumes.findById(
        retry && old
          ? old.resumeId
          : "sourceResumeId" in input
            ? input.sourceResumeId
            : ""
      )
      if (!source) throw new AppError("NOT_FOUND", "Resume not found")
      if (source.revision !== input.expectedRevision)
        throw new AppError("CONFLICT", "Resume changed")
      const resume = retry
        ? source
        : await resumes.create({
            schemaVersion: source.schemaVersion,
            templateId: source.templateId,
            templateOptions: structuredClone(source.templateOptions),
            title: `${source.title} copy`,
            subtitle: "Draft · not tailored",
            data: input.document,
          })
      let targetId = old?.jobTargetId ?? ""
      if (!retry && "jobText" in input) {
        targetId = this.db.uuid()
        this.db.jobTargets.push({
          id: targetId,
          platform: input.platform,
          externalJobId: input.externalJobId,
          sourceUrl: input.sourceUrl,
          rawText: input.jobText,
          title: "",
          company: "",
          location: null,
          requirements: { mustHaves: [], niceToHaves: [], keywords: [] },
          createdAt: this.db.now().toISOString(),
        })
        this.db.resumeJobTargets.push({
          resumeId: resume.id,
          jobTargetId: targetId,
          isOrigin: true,
        })
      }
      const version = await new InMemoryVersionRepository(this.db).create({
        resumeId: resume.id,
        content: resume.data,
        schemaVersion: 1,
        contentHash: input.contentHash,
        label: "Before tailoring",
        createdBy: "system",
        dedupe: false,
      })
      const conversation = this.db.conversations.find(
        (c) => c.resumeId === resume.id
      ) ?? { id: this.db.uuid(), resumeId: resume.id }
      if (!this.db.conversations.includes(conversation))
        this.db.conversations.push(conversation)
      const run = await new InMemoryAgentRunRepository(this.db).create({
        conversationId: conversation.id,
        resumeId: resume.id,
        resumeVersionId: version.version.id,
        hintSkillId: "tailor_from_job",
        model: "pending",
        input: {},
        selectedNodeId: null,
        structural: false,
      })
      const row: TailorOperation = {
        legacy: false,
        id: this.db.uuid(),
        bindingId: old?.bindingId ?? this.db.uuid(),
        resumeId: resume.id,
        jobTargetId: targetId,
        attempt: (old?.attempt ?? 0) + 1,
        status: "queued",
        expectedRevision: resume.revision,
        inputVersionId: version.version.id,
        idempotencyKey: input.idempotencyKey,
        deadline: new Date(this.db.now().getTime() + ATTEMPT_MS).toISOString(),
        errorClass: null,
        agentRunId: run.id,
      }
      this.rows.push(row)
      this.bindings.set(input.externalJobId, {
        identity: {
          platform: input.platform,
          externalJobId: input.externalJobId,
        },
        operationId: row.id,
      })
      return structuredClone(row)
    })
  }
  async transition(
    id: string,
    action: "claim" | "complete" | "cancel" | "reconcile"
  ): Promise<TailorOperation> {
    return this.locked(async () => {
      const row = this.rows.find((o) => o.id === id)
      if (!row) throw new AppError("NOT_FOUND", "Attempt not found")
      if (!isActive(row)) return structuredClone(row)
      const resume = this.db.resumes.find((r) => r.id === row.resumeId)
      if (!resume || resume.deletedAt) this.finish(row, "failed", "deleted")
      else if (Date.parse(row.deadline) <= this.db.now().getTime())
        this.finish(row, "failed", "expired")
      else if (action === "cancel") this.finish(row, "cancelled")
      else if (action === "claim") row.status = "running"
      else if (action === "complete") {
        if (resume.revision !== row.expectedRevision)
          this.finish(row, "failed", "conflict")
        else {
          const artifact = this.artifacts.get(id)
          if (!artifact) throw new AppError("NOT_FOUND", "Output not found")
          await new InMemoryVersionRepository(this.db).create({
            resumeId: row.resumeId,
            content: artifact.document,
            schemaVersion: 1,
            contentHash: artifact.contentHash,
            label: artifact.label,
            createdBy: "system",
            agentRunId: row.agentRunId,
            dedupe: false,
          })
          resume.subtitle = artifact.subtitle
          this.finish(row, "succeeded")
        }
      }
      return structuredClone(row)
    })
  }
  private finish(
    row: TailorOperation,
    status: "failed" | "cancelled" | "succeeded",
    reason: OperationError | null = null
  ) {
    row.status = status
    row.errorClass = reason
    this.artifacts.delete(row.id)
    const run = this.db.runs.find((r) => r.id === row.agentRunId)
    if (run) {
      run.status = status === "succeeded" ? "completed" : status
      run.errorClass = reason
    }
  }
  async fail(id: string, reason: OperationError): Promise<TailorOperation> {
    return this.locked(async () => {
      const row = this.rows.find((o) => o.id === id)
      if (!row) throw new AppError("NOT_FOUND", "Attempt not found")
      if (isActive(row)) this.finish(row, "failed", reason)
      return structuredClone(row)
    })
  }
  async stage(id: string, artifact: TailorArtifact): Promise<void> {
    const operation = await this.transition(id, "reconcile")
    if (isActive(operation) && !this.artifacts.has(id))
      this.artifacts.set(id, structuredClone(artifact))
  }
  async hasArtifact(id: string) {
    return this.artifacts.has(id)
  }
  async savePosting(id: string, posting: ParsedJobPosting) {
    this.postings.set(id, structuredClone(posting))
  }
  async parsedPosting(id: string) {
    return this.postings.get(id) ?? null
  }
}
