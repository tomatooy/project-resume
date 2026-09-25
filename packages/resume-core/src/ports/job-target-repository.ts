import type { JobIdentity } from "../domain/job-identity"
import type { JobTarget, NewJobTarget } from "../domain/job-target"

export type LinkJobTargetInput = {
  resumeId: string
  jobTargetId: string
  /** True for the posting the resume was generated from. */
  isOrigin: boolean
}

export interface JobTargetRepository {
  findByIdentity(identity: JobIdentity): Promise<JobTarget[]>
  create(input: NewJobTarget): Promise<JobTarget>
  findById(id: string): Promise<JobTarget | null>
  /** Idempotent: linking the same pair twice is not an error. */
  link(input: LinkJobTargetInput): Promise<void>
  /** Newest first. No reader yet; the link exists so the fact is not lost. */
  listForResume(resumeId: string): Promise<JobTarget[]>
}
