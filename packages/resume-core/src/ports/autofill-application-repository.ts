import type { AutofillVendor } from "@workspace/autofill"

import type { Counts } from "../domain/autofill"

export type AutofillApplicationInput = {
  vendor: AutofillVendor
  postingKey: string
  orgSlug: string | null
  url: string
  company: string | null
  title: string | null
  resumeId: string
  resumeVersionId: string
  /** Set only when the job description is used (spec 14.4). */
  jobTargetId: string | null
}

/** A record as the panel's earlier-fill line reads it. */
export type AutofillApplicationRecord = {
  id: string
  updatedAt: string
  resumeId: string | null
  resumeTitle: string | null
}

/**
 * One record per posting the user filled, never a claim that they submitted
 * it. Owner-scoped like every other repository.
 */
export interface AutofillApplicationRepository {
  /** One row per (user, vendor, posting key): a second call updates it and keeps the id. */
  upsert(input: AutofillApplicationInput): Promise<{ id: string }>
  find(
    vendor: AutofillVendor,
    postingKey: string
  ): Promise<AutofillApplicationRecord | null>
  /** The resume of the most recently updated record whose resume is not deleted. */
  latestResumeId(): Promise<string | null>
  updateCounts(id: string, counts: Counts): Promise<void>
}
