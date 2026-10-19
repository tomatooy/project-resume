import type { Profile } from "@workspace/autofill"

import { AppError } from "../domain/errors"
import type {
  AutofillProfileRepository,
  StoredProfile,
} from "../ports/autofill-profile-repository"
import { type InMemoryDb, nowIso } from "./db"

/**
 * Mirrors `save_autofill_profile` and its trigger: expected revision 0 means
 * no row yet, and the revision and time move only when the data changes.
 */
export class InMemoryAutofillProfileRepository
  implements AutofillProfileRepository
{
  constructor(private readonly db: InMemoryDb) {}

  async get(): Promise<StoredProfile | null> {
    const row = this.db.autofillProfile
    return row ? { ...row } : null
  }

  async save(input: {
    data: Profile
    schemaVersion: number
    expectedRevision: number
  }): Promise<{ revision: number; updatedAt: string }> {
    const row = this.db.autofillProfile
    if ((row?.revision ?? 0) !== input.expectedRevision) {
      throw new AppError("CONFLICT", "Profile changed")
    }
    if (!row) {
      const created = {
        data: input.data,
        schemaVersion: input.schemaVersion,
        revision: 1,
        updatedAt: nowIso(this.db),
      }
      this.db.autofillProfile = created
      return { revision: created.revision, updatedAt: created.updatedAt }
    }
    if (JSON.stringify(row.data) !== JSON.stringify(input.data)) {
      row.revision += 1
      row.updatedAt = nowIso(this.db)
    }
    row.data = input.data
    row.schemaVersion = input.schemaVersion
    return { revision: row.revision, updatedAt: row.updatedAt }
  }
}
