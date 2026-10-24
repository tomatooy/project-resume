import type { Profile } from "@workspace/autofill"

/** The caller's stored Profile row. */
export type StoredProfile = {
  data: Profile
  schemaVersion: number
  revision: number
  updatedAt: string
}

/**
 * The caller's Profile, one row per user. Expected revision 0 means "no row
 * yet"; a mismatch throws `AppError("CONFLICT", "Profile changed")`.
 */
export interface AutofillProfileRepository {
  /** Null before the first save. */
  get(): Promise<StoredProfile | null>
  /** The revision moves only when the data changes. */
  save(input: {
    data: Profile
    schemaVersion: number
    expectedRevision: number
  }): Promise<{ revision: number; updatedAt: string }>
}
