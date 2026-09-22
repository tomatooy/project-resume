import type { CustomSkill, SkillOverlay, UserSkillInput } from "../domain/skill"
import type { SkillRepository } from "../ports/skill-repository"
import type { InMemoryDb } from "./db"
import { nowIso } from "./db"

export class InMemorySkillRepository implements SkillRepository {
  constructor(private readonly db: InMemoryDb) {}

  async listOverlay(): Promise<SkillOverlay> {
    return {
      custom: this.db.userSkills.map((row) => ({ ...row })),
      disabledIds: [...this.db.disabledSkills],
    }
  }

  async getCustom(id: string): Promise<CustomSkill | null> {
    const row = this.db.userSkills.find(
      (skill) => skill.id === id && !skill.deletedAt
    )
    return row ? { ...row } : null
  }

  async countLive(): Promise<number> {
    return this.db.userSkills.filter((row) => !row.deletedAt).length
  }

  async create(input: UserSkillInput): Promise<CustomSkill> {
    const row: CustomSkill = {
      ...input,
      id: `usr_${this.db.uuid()}`,
      createdAt: nowIso(this.db),
      deletedAt: null,
    }
    this.db.userSkills.push(row)
    return { ...row }
  }

  async update(id: string, input: UserSkillInput): Promise<CustomSkill | null> {
    const row = this.db.userSkills.find(
      (skill) => skill.id === id && !skill.deletedAt
    )
    if (!row) return null
    // Fields left out of the input are cleared, the same way the adapter
    // writes the whole column set: the editor always sends the full record.
    Object.assign(row, input, {
      whenToUse: input.whenToUse,
      notFor: input.notFor,
      starter: input.starter,
    })
    return { ...row }
  }

  async softDelete(id: string): Promise<boolean> {
    const row = this.db.userSkills.find(
      (skill) => skill.id === id && !skill.deletedAt
    )
    if (!row) return false
    row.deletedAt = nowIso(this.db)
    return true
  }

  async setDisabled(skillId: string, disabled: boolean): Promise<void> {
    const at = this.db.disabledSkills.indexOf(skillId)
    if (disabled && at === -1) this.db.disabledSkills.push(skillId)
    if (!disabled && at !== -1) this.db.disabledSkills.splice(at, 1)
  }
}
