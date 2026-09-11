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
 * The playbook library: the catalog rows with their bodies attached.
 *
 * Server-side only. `./catalog` is the client-safe half, and the subpath
 * export points at it, so a chip label never drags a body into the browser
 * bundle.
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

const byId = new Map<string, Skill>(SKILLS.map((skill) => [skill.id, skill]))

/** A playbook by id, or undefined for an id this library does not hold. */
export function skillOfId(id: string): Skill | undefined {
  return byId.get(id)
}

/** A short label for an id, tolerating one stored by an older release. */
export function skillNameOf(id: string): string | undefined {
  return byId.get(id)?.name
}

/** Playbook ids matching a query by name, when-to-use or body. */
export function findSkills(query: string, limit: number): Skill[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length > 2)
  if (terms.length === 0) return SKILLS.slice(0, limit)

  const scored = SKILLS.map((skill) => {
    const haystack =
      `${skill.id} ${skill.name} ${skill.whenToUse} ${skill.body}`.toLowerCase()
    let score = 0
    for (const term of terms) {
      if (haystack.includes(term)) score += 1
    }
    return { skill, score }
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))

  // A query that matched nothing returns the index: a model that guessed the
  // wrong words still finds its way rather than concluding nothing exists.
  if (scored.length === 0) return SKILLS.slice(0, limit)
  return scored.slice(0, limit).map((entry) => entry.skill)
}

export { SKILL_IDS, skillIndexLines } from "./catalog"
export type { Skill, SkillMeta } from "./types"
