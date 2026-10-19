import {
  emptyProfile,
  type Profile,
  PROFILE_SCHEMA_VERSION,
} from "@workspace/autofill"

import type { ProfileState } from "../domain/autofill"
import type { AutofillProfileRepository } from "../ports/autofill-profile-repository"

/** The user's structured answers, saved whole under a revision check. */
export class AutofillProfileService {
  constructor(private readonly profiles: AutofillProfileRepository) {}

  async get(): Promise<ProfileState> {
    const stored = await this.profiles.get()
    if (!stored) {
      return {
        profile: emptyProfile,
        revision: 0,
        updatedAt: null,
        exists: false,
      }
    }
    return {
      profile: stored.data,
      revision: stored.revision,
      updatedAt: stored.updatedAt,
      exists: true,
    }
  }

  save(input: {
    profile: Profile
    expectedRevision: number
  }): Promise<{ revision: number; updatedAt: string }> {
    return this.profiles.save({
      data: input.profile,
      schemaVersion: PROFILE_SCHEMA_VERSION,
      expectedRevision: input.expectedRevision,
    })
  }
}
