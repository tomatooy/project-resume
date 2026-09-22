import type { Skill } from "./types"

/**
 * Playbook ids matching a query by name, description, optional when-to-use and body.
 *
 * Takes the library rather than reading the built-in one: a turn's library is
 * built-ins plus the user's overlay, and a disabled or deleted skill must not
 * be findable.
 */
export function findSkills(
  skills: readonly Skill[],
  query: string,
  limit: number
): Skill[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length > 2)
  if (terms.length === 0) return skills.slice(0, limit)

  const scored = skills
    .map((skill) => {
      const haystack =
        `${skill.id} ${skill.name} ${skill.description} ${skill.whenToUse ?? ""} ${skill.body}`.toLowerCase()
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
  if (scored.length === 0) return skills.slice(0, limit)
  return scored.slice(0, limit).map((entry) => entry.skill)
}
