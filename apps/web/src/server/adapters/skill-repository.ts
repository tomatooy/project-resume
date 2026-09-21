import {
  SkillCategorySchema,
  type CustomSkill,
  type SkillOverlay,
  type SkillRepository,
  type UserSkillInput,
} from "@workspace/resume-core"

import type { Db } from "../auth/supabase"

type SkillRow = {
  id: string
  category: string
  name: string
  when_to_use: string
  not_for: string | null
  starter: string | null
  body: string
  created_at: string
  deleted_at: string | null
}

// Written out rather than selected with `*`, and paired with the row type by
// hand: the two have to agree, and a column added to one and not the other is
// a type error at the call site rather than a silently missing field.
const COLUMNS =
  "id, category, name, when_to_use, not_for, starter, body, created_at, deleted_at"

/** A null column is an absent field, not an empty one. */
function toCustomSkill(row: SkillRow): CustomSkill {
  return {
    id: row.id,
    // A check constraint holds the two values, so a parse failure here is a
    // stored row that no longer fits the contract, which is an INTERNAL 500
    // rather than a silent fallback to one group.
    category: SkillCategorySchema.parse(row.category),
    name: row.name,
    whenToUse: row.when_to_use,
    notFor: row.not_for ?? undefined,
    starter: row.starter ?? undefined,
    body: row.body,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  }
}

export class SupabaseSkillRepository implements SkillRepository {
  constructor(
    private readonly db: Db,
    private readonly userId: string
  ) {}

  async listOverlay(): Promise<SkillOverlay> {
    // One round trip each, in parallel: every turn reads both, and neither
    // depends on the other.
    const [skills, disabled] = await Promise.all([
      this.db
        .from("user_skills")
        .select(COLUMNS)
        .order("created_at", { ascending: true }),
      this.db
        .from("user_disabled_skills")
        .select("skill_id")
        .order("created_at", { ascending: true }),
    ])
    if (skills.error) throw skills.error
    if (disabled.error) throw disabled.error
    return {
      custom: (skills.data ?? []).map(toCustomSkill),
      disabledIds: (disabled.data ?? []).map((row) => row.skill_id),
    }
  }

  async getCustom(id: string): Promise<CustomSkill | null> {
    const { data, error } = await this.db
      .from("user_skills")
      .select(COLUMNS)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle()

    if (error) throw error
    return data ? toCustomSkill(data) : null
  }

  async countLive(): Promise<number> {
    const { count, error } = await this.db
      .from("user_skills")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)

    if (error) throw error
    return count ?? 0
  }

  async create(input: UserSkillInput): Promise<CustomSkill> {
    const { data, error } = await this.db
      .from("user_skills")
      .insert({
        user_id: this.userId,
        category: input.category,
        name: input.name,
        when_to_use: input.whenToUse,
        not_for: input.notFor ?? null,
        starter: input.starter ?? null,
        body: input.body,
      })
      .select(COLUMNS)
      .single()

    if (error) throw error
    return toCustomSkill(data)
  }

  async update(id: string, input: UserSkillInput): Promise<CustomSkill | null> {
    const { data, error } = await this.db
      .from("user_skills")
      .update({
        category: input.category,
        name: input.name,
        when_to_use: input.whenToUse,
        not_for: input.notFor ?? null,
        starter: input.starter ?? null,
        body: input.body,
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select(COLUMNS)
      .maybeSingle()

    if (error) throw error
    return data ? toCustomSkill(data) : null
  }

  async softDelete(id: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("user_skills")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")

    if (error) throw error
    return (data?.length ?? 0) > 0
  }

  async setDisabled(skillId: string, disabled: boolean): Promise<void> {
    if (!disabled) {
      const { error } = await this.db
        .from("user_disabled_skills")
        .delete()
        .eq("skill_id", skillId)
      if (error) throw error
      return
    }
    const { error } = await this.db
      .from("user_disabled_skills")
      .upsert(
        { user_id: this.userId, skill_id: skillId },
        { onConflict: "user_id,skill_id", ignoreDuplicates: true }
      )
    if (error) throw error
  }
}
