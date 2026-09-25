import type { Resume } from "@workspace/resume-schema"
import type { JobIdentity } from "../domain/job-identity"
import type { ParsedJobPosting } from "../domain/job-target"
import type {
  JobLookup,
  OperationError,
  TailorAdmission,
  TailorOperation,
  TailorRetry,
} from "../domain/tailor-operation"

export type PreparedAdmission = (TailorAdmission | TailorRetry) & {
  expectedRevision: number
  document: Resume
  contentHash: string
}
export type TailorArtifact = {
  document: Resume
  contentHash: string
  title: string
  subtitle: string
  label: string
}
export type CreationCommit = TailorArtifact & {
  resumeId: string
  runId: string
  expectedRevision: number
  model: string
  latencyMs: number
}

export interface TailorOperationRepository {
  commitCreation(input: CreationCommit): Promise<boolean>
  lookup(identity: JobIdentity): Promise<JobLookup>
  claimDispatch(id: string): Promise<string | null>
  admit(input: PreparedAdmission): Promise<TailorOperation>
  recordModel(id: string, model: string): Promise<void>
  get(id: string): Promise<TailorOperation>
  identity(id: string): Promise<JobIdentity>
  transition(
    id: string,
    action: "claim" | "complete" | "cancel" | "reconcile"
  ): Promise<TailorOperation>
  fail(id: string, errorClass: OperationError): Promise<TailorOperation>
  stage(id: string, artifact: TailorArtifact): Promise<void>
  hasArtifact(id: string): Promise<boolean>
  savePosting(targetId: string, posting: ParsedJobPosting): Promise<void>
  parsedPosting(targetId: string): Promise<ParsedJobPosting | null>
}
