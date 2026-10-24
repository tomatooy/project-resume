import { jobIdentityFromUrl, type JobIdentity } from "../domain/job-identity"
import type { JobTarget, NewJobTarget } from "../domain/job-target"
import type {
  JobTargetRepository,
  LinkJobTargetInput,
  OriginJob,
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
    this.db.resumeJobTargets.push({
      ...input,
      createdAt: this.db.now().toISOString(),
    })
  }

  async listForResume(resumeId: string): Promise<JobTarget[]> {
    const ids = this.db.resumeJobTargets
      .filter((row) => row.resumeId === resumeId)
      .map((row) => row.jobTargetId)
    return this.db.jobTargets.filter((row) => ids.includes(row.id)).reverse()
  }

  async listOrigins(limit: number): Promise<OriginJob[]> {
    const live = new Set(
      this.db.resumes.filter((row) => !row.deletedAt).map((row) => row.id)
    )
    // Reversed first so that links made at the same moment keep insertion
    // order, newest first, through the stable sort.
    const links = this.db.resumeJobTargets
      .filter((link) => link.isOrigin && live.has(link.resumeId))
      .reverse()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const rows: OriginJob[] = []
    for (const link of links) {
      const target = this.db.jobTargets.find(
        (row) => row.id === link.jobTargetId
      )
      if (!target) continue
      rows.push({
        resumeId: link.resumeId,
        company: target.company,
        title: target.title,
        linkedAt: link.createdAt,
      })
    }
    return rows.slice(0, limit)
  }

  async findOrigin(resumeId: string): Promise<JobTarget | null> {
    return originOf(this.db, resumeId)
  }
}

/**
 * The posting linked as the resume's origin, newest if there were ever more
 * than one. Shared with the resume repository, whose summaries carry it.
 */
export function originOf(db: InMemoryDb, resumeId: string): JobTarget | null {
  const link = db.resumeJobTargets
    .filter((row) => row.resumeId === resumeId && row.isOrigin)
    .at(-1)
  if (!link) return null
  return db.jobTargets.find((row) => row.id === link.jobTargetId) ?? null
}
