import {
  AppError,
  AutofillProfileSchema,
  PolicySchema,
  reviewPolicy,
  type AutofillProfileRepository,
  type AutofillQuota,
  type AutofillPolicyProvider,
  type ProfileData,
  ScopedAnswerSchema,
  SavedAnswerSchema,
  type SavedAnswer,
  type SavedAnswerRepository,
  type ScopedAnswer,
  type ScopedAnswerRepository,
} from "@workspace/resume-core"
import type { Db } from "../auth/supabase"
import { toJson } from "./json"
import { z } from "zod"

const savedAnswerData = ScopedAnswerSchema.pick({
  meaning: true,
  conditions: true,
  value: true,
  provenance: true,
})
/**
 * The marker a row in the question's own shape carries. Rows without it are
 * rows the retired vocabulary wrote, and each reader sees only its own: a
 * shape neither reader can parse must not be handed to it, because a stored row
 * that fails to parse would fail a whole page run rather than one row.
 */
const QUESTION_SHAPE = "question"
const savedQuestionData = z.strictObject({
  shape: z.literal(QUESTION_SHAPE),
  question: SavedAnswerSchema.shape.question,
  value: SavedAnswerSchema.shape.value,
})
const savedQuestionRow = z.object({
  id: z.uuid(),
  revision: z.number(),
  data: savedQuestionData,
  confirmed_at: z.string(),
  updated_at: z.string(),
})
function savedQuestionFromRow(
  raw: z.input<typeof savedQuestionRow>
): SavedAnswer {
  const row = savedQuestionRow.parse(raw)
  return SavedAnswerSchema.parse({
    id: row.id,
    revision: row.revision,
    question: row.data.question,
    value: row.data.value,
    confirmedAt: new Date(row.confirmed_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  })
}
export class SupabaseSavedAnswerRepository implements SavedAnswerRepository {
  constructor(
    private readonly db: Db,
    private readonly userId: string
  ) {}

  async list(): Promise<SavedAnswer[]> {
    const { data, error } = await this.db
      .from("autofill_scoped_answers")
      .select("id,revision,data,confirmed_at,updated_at")
      .eq("user_id", this.userId)
      .eq("data->>shape", QUESTION_SHAPE)
      .order("updated_at", { ascending: false })
    if (error) throw error
    return (data ?? []).map((row) =>
      savedQuestionFromRow({ ...row, data: savedQuestionData.parse(row.data) })
    )
  }

  async save(
    answer: SavedAnswer,
    expectedRevision: number
  ): Promise<SavedAnswer | null> {
    const value = {
      data: toJson({
        shape: QUESTION_SHAPE,
        question: answer.question,
        value: answer.value,
      }),
      confirmed_at: answer.confirmedAt,
    }
    const query =
      expectedRevision === 0
        ? this.db
            .from("autofill_scoped_answers")
            .insert({ ...value, id: answer.id, user_id: this.userId })
        : this.db
            .from("autofill_scoped_answers")
            .update(value)
            .eq("id", answer.id)
            .eq("user_id", this.userId)
            .eq("revision", expectedRevision)
    const { data, error } = await query
      .select("id,revision,data,confirmed_at,updated_at")
      .maybeSingle()
    if (error?.code === "23505") return null
    if (error) throw error
    return data
      ? savedQuestionFromRow({
          ...data,
          data: savedQuestionData.parse(data.data),
        })
      : null
  }

  async remove(id: string, expectedRevision: number): Promise<boolean> {
    const { data, error } = await this.db
      .from("autofill_scoped_answers")
      .delete()
      .eq("id", id)
      .eq("user_id", this.userId)
      .eq("revision", expectedRevision)
      .eq("data->>shape", QUESTION_SHAPE)
      .select("id")
      .maybeSingle()
    if (error) throw error
    return Boolean(data)
  }
}
const savedAnswerRow = z.object({
  id: z.uuid(),
  revision: z.number(),
  data: savedAnswerData,
  confirmed_at: z.string(),
  updated_at: z.string(),
})
function answerFromRow(raw: z.input<typeof savedAnswerRow>): ScopedAnswer {
  const row = savedAnswerRow.parse(raw)
  return ScopedAnswerSchema.parse({
    ...row.data,
    id: row.id,
    revision: row.revision,
    confirmedAt: new Date(row.confirmed_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  })
}

export class SupabaseScopedAnswerRepository implements ScopedAnswerRepository {
  constructor(
    private readonly db: Db,
    private readonly userId: string
  ) {}

  async list(): Promise<ScopedAnswer[]> {
    const { data, error } = await this.db
      .from("autofill_scoped_answers")
      .select("id,revision,data,confirmed_at,updated_at")
      .eq("user_id", this.userId)
      // Rows in the question's own shape belong to the reader that owns that
      // shape. This one only ever sees rows it can parse.
      .not("data->>shape", "eq", QUESTION_SHAPE)
      .order("updated_at", { ascending: false })
    if (error) throw error
    return (data ?? []).map((row) =>
      answerFromRow({ ...row, data: savedAnswerData.parse(row.data) })
    )
  }

  async save(
    answer: ScopedAnswer,
    expectedRevision: number
  ): Promise<ScopedAnswer | null> {
    const value = {
      data: toJson({
        meaning: answer.meaning,
        conditions: answer.conditions,
        value: answer.value,
        provenance: answer.provenance,
      }),
      confirmed_at: answer.confirmedAt,
    }
    const query =
      expectedRevision === 0
        ? this.db
            .from("autofill_scoped_answers")
            .insert({ ...value, id: answer.id, user_id: this.userId })
        : this.db
            .from("autofill_scoped_answers")
            .update(value)
            .eq("id", answer.id)
            .eq("user_id", this.userId)
            .eq("revision", expectedRevision)
    const { data, error } = await query
      .select("id,revision,data,confirmed_at,updated_at")
      .maybeSingle()
    if (error?.code === "23505") return null
    if (error) throw error
    return data
      ? answerFromRow({ ...data, data: savedAnswerData.parse(data.data) })
      : null
  }

  async remove(id: string, expectedRevision: number): Promise<boolean> {
    const { data, error } = await this.db
      .from("autofill_scoped_answers")
      .delete()
      .eq("id", id)
      .eq("user_id", this.userId)
      .eq("revision", expectedRevision)
      .select("id")
      .maybeSingle()
    if (error) throw error
    return Boolean(data)
  }
}
export class SupabaseAutofillProfileRepository
  implements AutofillProfileRepository
{
  constructor(
    private readonly db: Db,
    private readonly userId: string
  ) {}
  async get() {
    const { data, error } = await this.db
      .from("autofill_profiles")
      .select("schema_version,revision,data")
      .eq("user_id", this.userId)
      .maybeSingle()
    if (error) throw error
    return data
      ? AutofillProfileSchema.parse({
          schemaVersion: data.schema_version,
          revision: data.revision,
          data: data.data,
        })
      : null
  }
  async save(expectedRevision: number, value: ProfileData) {
    const query =
      expectedRevision === 0
        ? this.db
            .from("autofill_profiles")
            .insert({ user_id: this.userId, data: toJson(value) })
        : this.db
            .from("autofill_profiles")
            .update({ data: toJson(value) })
            .eq("user_id", this.userId)
            .eq("revision", expectedRevision)
    const { data, error } = await query
      .select("schema_version,revision,data")
      .maybeSingle()
    if (error?.code === "23505") return null
    if (error) throw error
    return data
      ? AutofillProfileSchema.parse({
          schemaVersion: data.schema_version,
          revision: data.revision,
          data: data.data,
        })
      : null
  }
}
export class SupabaseAutofillQuota implements AutofillQuota {
  constructor(private readonly db: Db) {}
  async reserve(kind: "plan" | "jev") {
    const { data, error } = await this.db.rpc("autofill_reserve_quota", {
      p_kind: kind,
    })
    if (error) throw error
    if (!data)
      throw new AppError(
        "RATE_LIMITED",
        "autofill_quota",
        undefined,
        kind === "plan" ? 60 : 3600,
        "autofill_quota"
      )
  }
}
export class EnvironmentAutofillPolicy implements AutofillPolicyProvider {
  async get() {
    const fallback = reviewPolicy()
    const raw = process.env.AUTOFILL_POLICY
    if (!raw)
      return {
        ...fallback,
        enabled: process.env.AUTOFILL_ENABLED === "true",
        jevEnabled: process.env.AUTOFILL_JEV_ENABLED === "true",
      }
    try {
      return PolicySchema.parse({
        ...JSON.parse(raw),
        expiresAt: fallback.expiresAt,
      })
    } catch {
      return { ...fallback, enabled: false }
    }
  }
}
