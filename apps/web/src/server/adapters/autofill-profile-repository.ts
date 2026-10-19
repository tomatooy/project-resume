import { emptyProfile, type Profile, ProfileSchema } from "@workspace/autofill"
import {
  AppError,
  type AutofillProfileRepository,
  type StoredProfile,
} from "@workspace/resume-core"
import { z } from "zod"

import type { Db } from "../auth/supabase"
import { toJson } from "./json"

/** `save_autofill_profile` returns `jsonb`, parsed for the same reason as `rpc.ts`. */
const savedSchema = z.object({ revision: z.number(), updated_at: z.string() })

export class SupabaseAutofillProfileRepository
  implements AutofillProfileRepository
{
  constructor(
    private readonly db: Db,
    private readonly userId: string
  ) {}

  /**
   * A stored document that no longer parses reads as the empty Profile at its
   * stored revision, so the next save replaces it instead of every read
   * failing.
   */
  async get(): Promise<StoredProfile | null> {
    const { data, error } = await this.db
      .from("autofill_profiles")
      .select("data, schema_version, revision, updated_at")
      .eq("user_id", this.userId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const parsed = ProfileSchema.safeParse(data.data)
    return {
      data: parsed.success ? parsed.data : emptyProfile,
      schemaVersion: data.schema_version,
      revision: data.revision,
      updatedAt: data.updated_at,
    }
  }

  async save(input: {
    data: Profile
    schemaVersion: number
    expectedRevision: number
  }): Promise<{ revision: number; updatedAt: string }> {
    const { data, error } = await this.db.rpc("save_autofill_profile", {
      p_data: toJson(input.data),
      p_schema_version: input.schemaVersion,
      p_expected_revision: input.expectedRevision,
    })
    if (error?.code === "P0409") {
      throw new AppError("CONFLICT", "Profile changed")
    }
    if (error) throw error
    const saved = savedSchema.parse(data)
    return { revision: saved.revision, updatedAt: saved.updated_at }
  }
}
