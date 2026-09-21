import { SKILL_META } from "./catalog"
import { skillOf } from "./define"
import { cutToLength } from "./playbooks/cut-to-length"
import { grammarClarity } from "./playbooks/grammar-clarity"
import { impactBullets } from "./playbooks/impact-bullets"
import { matchPosting } from "./playbooks/match-posting"
import { resumeQuantifier } from "./playbooks/resume-quantifier"
import { techResumeOptimizer } from "./playbooks/tech-resume-optimizer"
import type { Skill } from "./types"

/**
 * The built-in playbook library: the catalog rows with their bodies attached.
 *
 * Shipped, not stored. A user's own skills live in the overlay and meet this
 * library in `mergeSkills`, which is what a turn reads; these four exports are
 * the constant the evals pin and the built-in rows the merge starts from.
 */
const bodies: Record<string, string> = {
  bullet_rewrite: impactBullets,
  jd_match: matchPosting,
  grammar_clarity: grammarClarity,
  condense_to_pages: cutToLength,
  resume_quantifier: resumeQuantifier,
  tech_resume_optimizer: techResumeOptimizer,
}

export const SKILLS: readonly Skill[] = skillOf(SKILL_META, bodies)

/** A built-in playbook by id, or undefined for an id this library does not hold. */
export function skillOfId(id: string): Skill | undefined {
  return SKILLS.find((skill) => skill.id === id)
}
