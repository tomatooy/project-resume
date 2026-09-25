import { jobIdentityFromUrl, type JobIdentity } from "../domain/job-identity"
import type { JobTarget, NewJobTarget } from "../domain/job-target"
import type {
  JobTargetRepository,
  LinkJobTargetInput,
} from "../ports/job-target-repository"
import type { InMemoryDb } from "./db"

export class InMemoryJobTargetRepository implements JobTargetRepository {
  constructor(private readonly db: InMemoryDb) {}

  async findByIdentity(identity: JobIdentity): Promise<JobTarget[]> {
    for (const row of this.db.jobTargets) {
      if (row.platform === null && row.sourceUrl) {
        const found = jobIdentityFromUrl(row.sourceUrl)
        if (found) Object.assign(row, found)
      }
    }
    return this.db.jobTargets.filter(
      (r) =>
        r.platform === identity.platform &&
        r.externalJobId === identity.externalJobId
    )
  }
  async create(input: NewJobTarget): Promise<JobTarget> {
    const row: JobTarget = {
      ...input,
      id: this.db.uuid(),
      createdAt: this.db.now().toISOString(),
    }
    this.db.jobTargets.push(row)
    return row
  }

  async findById(id: string): Promise<JobTarget | null> {
    return this.db.jobTargets.find((row) => row.id === id) ?? null
  }

  async link(input: LinkJobTargetInput): Promise<void> {
    const existing = this.db.resumeJobTargets.find(
      (row) =>
        row.resumeId === input.resumeId && row.jobTargetId === input.jobTargetId
    )
    if (existing) return
    this.db.resumeJobTargets.push({ ...input })
  }

  async listForResume(resumeId: string): Promise<JobTarget[]> {
    const ids = this.db.resumeJobTargets
      .filter((row) => row.resumeId === resumeId)
      .map((row) => row.jobTargetId)
    return this.db.jobTargets.filter((row) => ids.includes(row.id)).reverse()
  }
}
