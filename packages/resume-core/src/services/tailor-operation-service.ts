import { contentHash, regenerateIds } from "@workspace/resume-schema"
import { AppError } from "../domain/errors"
import type { JobIdentity } from "../domain/job-identity"
import {
  TailorAdmissionSchema,
  boundJob,
  isActive,
  type TailorAdmission,
  type TailorRetry,
  type TailorOperation,
  type JobLookup,
  type OperationError,
} from "../domain/tailor-operation"
import type { JobParser } from "../ports/job-parser"
import type { JobTargetRepository } from "../ports/job-target-repository"
import type { ResumeRepository } from "../ports/resume-repository"
import type { ResumeTailor } from "../ports/resume-tailor"
import type { TailorOperationRepository } from "../ports/tailor-operation-repository"
import type { VersionRepository } from "../ports/version-repository"
import { finishTailoredDocument, tailorNames } from "./tailor-generation"

export class TailorOperationService {
  constructor(
    private readonly operations: TailorOperationRepository,
    private readonly resumes: ResumeRepository,
    private readonly versions: VersionRepository,
    private readonly targets: JobTargetRepository,
    private readonly parser: JobParser,
    private readonly writer: ResumeTailor,
    private readonly clock: () => Date = () => new Date()
  ) {}
  lookup(identity: JobIdentity): Promise<JobLookup> {
    return this.operations.lookup(identity)
  }
  async admit(input: TailorAdmission): Promise<JobLookup> {
    const checked = TailorAdmissionSchema.safeParse(input)
    if (!checked.success)
      throw new AppError("VALIDATION", "Invalid selected job")
    const existing = await this.lookup(input)
    if (existing.kind === "bound") return existing
    const source = await this.resumes.findById(input.sourceResumeId)
    if (!source) throw new AppError("NOT_FOUND", "Base resume not found")
    const document = regenerateIds(source.data)
    return boundJob(
      input,
      await this.operations.admit({
        ...checked.data,
        expectedRevision: source.revision,
        document,
        contentHash: await contentHash(document),
      })
    )
  }
  async retry(input: TailorRetry): Promise<JobLookup> {
    const found = await this.lookup(input)
    if (found.kind === "none")
      throw new AppError("NOT_FOUND", "Resume not found")
    const resume = await this.resumes.findById(found.resumeId)
    if (!resume) throw new AppError("NOT_FOUND", "Resume not found")
    return boundJob(
      input,
      await this.operations.admit({
        ...input,
        expectedRevision: resume.revision,
        document: resume.data,
        contentHash: await contentHash(resume.data),
      })
    )
  }
  async cancel(id: string): Promise<JobLookup> {
    return boundJob(
      await this.operations.identity(id),
      await this.operations.transition(id, "cancel")
    )
  }
  get(id: string) {
    return this.operations.get(id)
  }
  fail(id: string, reason: OperationError) {
    return this.operations.fail(id, reason)
  }
  async claim(id: string): Promise<void> {
    await this.runnable(id)
  }
  private async runnable(id: string): Promise<TailorOperation> {
    const operation = await this.operations.transition(id, "claim")
    if (
      !isActive(operation) ||
      Date.parse(operation.deadline) <= this.clock().getTime()
    )
      throw new AppError("CONFLICT", "Attempt is no longer active")
    return operation
  }
  async parse(id: string): Promise<void> {
    const operation = await this.runnable(id)
    if (await this.operations.parsedPosting(operation.jobTargetId)) return
    const target = await this.targets.findById(operation.jobTargetId)
    if (!target) throw new AppError("NOT_FOUND", "Posting not found")
    const { parsed, model } = await this.parser.parse({
      text: target.rawText,
      signal: this.signal(operation),
    })
    await this.runnable(id)
    await this.operations.recordModel(id, model)
    await this.operations.savePosting(target.id, parsed)
  }
  async generate(id: string): Promise<void> {
    const operation = await this.runnable(id)
    if (await this.operations.hasArtifact(id)) return
    const snapshot = await this.versions.findById(operation.inputVersionId)
    const posting = await this.operations.parsedPosting(operation.jobTargetId)
    const resume = await this.resumes.findById(operation.resumeId)
    if (!snapshot || !posting || !resume)
      throw new AppError("NOT_FOUND", "Attempt input not found")
    const { parsed, model } = await this.writer.tailor({
      resume: snapshot.content,
      posting,
      signal: this.signal(operation),
    })
    await this.operations.recordModel(id, model)
    const document = finishTailoredDocument(snapshot.content, parsed)
    await this.runnable(id)
    await this.operations.stage(id, {
      document,
      contentHash: await contentHash(document),
      ...tailorNames(posting, resume.title),
    })
  }
  async complete(id: string): Promise<void> {
    await this.operations.transition(id, "complete")
  }
  private signal(operation: TailorOperation): AbortSignal {
    return AbortSignal.timeout(
      Math.max(
        1,
        Math.min(
          120_000,
          Date.parse(operation.deadline) - this.clock().getTime()
        )
      )
    )
  }
}
