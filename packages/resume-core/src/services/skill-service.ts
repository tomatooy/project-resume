import { AppError } from "../domain/errors"
import {
  type CustomSkill,
  MAX_CUSTOM_SKILLS,
  type SkillOverlay,
  type UserSkillInput,
  parseSkillMarkdown,
} from "../domain/skill"
import type { SkillRepository } from "../ports/skill-repository"

/**
 * The user's library management: writing playbooks, removing them, and
 * switching any id off.
 *
 * It never sees the built-in rows. A skill is prompt text whichever tier it
 * lives in, so nothing here needs one, and the ids a toggle may name are
 * checked by the server function that can see both tiers.
 */
export class SkillService {
  constructor(private readonly skills: SkillRepository) {}

  listOverlay(): Promise<SkillOverlay> {
    return this.skills.listOverlay()
  }

  async get(id: string): Promise<CustomSkill> {
    const skill = await this.skills.getCustom(id)
    if (!skill) throw new AppError("NOT_FOUND", "Not found")
    return skill
  }

  /**
   * The cap is read then written, like the hourly limit. Two concurrent
   * creates can land a 21st row; that is accepted, and the next write names
   * the cap rather than the database refusing one.
   */
  async create(input: UserSkillInput): Promise<CustomSkill> {
    if ((await this.skills.countLive()) >= MAX_CUSTOM_SKILLS) {
      throw new AppError(
        "VALIDATION",
        `You can keep at most ${MAX_CUSTOM_SKILLS} custom skills. Remove one first.`
      )
    }
    return this.skills.create(input)
  }

  async update(id: string, input: UserSkillInput): Promise<CustomSkill> {
    const updated = await this.skills.update(id, input)
    if (!updated) throw new AppError("NOT_FOUND", "Not found")
    return updated
  }

  async remove(id: string): Promise<void> {
    if (!(await this.skills.softDelete(id))) {
      throw new AppError("NOT_FOUND", "Not found")
    }
  }

  setDisabled(skillId: string, disabled: boolean): Promise<void> {
    return this.skills.setDisabled(skillId, disabled)
  }

  /** Parses a `SKILL.md` for the editor to prefill; it does not save one. */
  importMarkdown(text: string): UserSkillInput {
    return parseSkillMarkdown(text)
  }
}
