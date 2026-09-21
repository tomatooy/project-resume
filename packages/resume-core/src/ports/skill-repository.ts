import type { CustomSkill, SkillOverlay, UserSkillInput } from "../domain/skill"

export interface SkillRepository {
  /** Every custom row in creation order, soft-deleted ones included. */
  listOverlay(): Promise<SkillOverlay>
  /** One live custom row, body included; null for a deleted or unknown id. */
  getCustom(id: string): Promise<CustomSkill | null>
  /** Live rows only, which is what the cap counts. */
  countLive(): Promise<number>
  create(input: UserSkillInput): Promise<CustomSkill>
  /** Null when no live row matched. */
  update(id: string, input: UserSkillInput): Promise<CustomSkill | null>
  /** False when no live row matched. */
  softDelete(id: string): Promise<boolean>
  /** Idempotent: disabling twice is not an error. */
  setDisabled(skillId: string, disabled: boolean): Promise<void>
}
