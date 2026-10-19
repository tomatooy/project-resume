import type { AutofillVendor } from "@workspace/autofill"

import type { Counts } from "../domain/autofill"
import type {
  AutofillApplicationInput,
  AutofillApplicationRecord,
  AutofillApplicationRepository,
} from "../ports/autofill-application-repository"
import { type InMemoryDb, nowIso } from "./db"

/**
 * Mirrors the Supabase adapter: the unique (user, vendor, posting key) makes a
 * second upsert update the row in place, and `updated_at` moves on every
 * write, as the table's trigger moves it.
 */
export class InMemoryAutofillApplicationRepository
  implements AutofillApplicationRepository
{
  constructor(private readonly db: InMemoryDb) {}

  async upsert(input: AutofillApplicationInput): Promise<{ id: string }> {
    const now = nowIso(this.db)
    const row = this.row(input.vendor, input.postingKey)
    if (row) {
      Object.assign(row, input, { updatedAt: now })
      return { id: row.id }
    }
    const id = this.db.uuid()
    this.db.autofillApplications.push({
      id,
      ...input,
      counts: null,
      createdAt: now,
      updatedAt: now,
    })
    return { id }
  }

  async find(
    vendor: AutofillVendor,
    postingKey: string
  ): Promise<AutofillApplicationRecord | null> {
    const row = this.row(vendor, postingKey)
    if (!row) return null
    // Soft-deleted or not, as the adapter's plain embed reads it: the line
    // says which resume filled the posting then.
    const resume = this.db.resumes.find((r) => r.id === row.resumeId)
    return {
      id: row.id,
      updatedAt: row.updatedAt,
      resumeId: row.resumeId,
      resumeTitle: resume?.title ?? null,
    }
  }

  async latestResumeId(): Promise<string | null> {
    const live = new Set(
      this.db.resumes.filter((r) => !r.deletedAt).map((r) => r.id)
    )
    const latest = this.db.autofillApplications
      .filter((row) => row.resumeId !== null && live.has(row.resumeId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    return latest?.resumeId ?? null
  }

  async updateCounts(id: string, counts: Counts): Promise<void> {
    const row = this.db.autofillApplications.find((r) => r.id === id)
    if (!row) return
    row.counts = counts
    row.updatedAt = nowIso(this.db)
  }

  private row(vendor: AutofillVendor, postingKey: string) {
    return this.db.autofillApplications.find(
      (r) => r.vendor === vendor && r.postingKey === postingKey
    )
  }
}
