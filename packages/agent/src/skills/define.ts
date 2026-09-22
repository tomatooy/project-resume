import type { Skill, SkillMeta } from "./types"

/** Built-ins require the same core fields as custom skills. */
export function defineSkill(record: Skill): Skill {
  for (const field of ["id", "name", "description", "body"] as const) {
    if (record[field].trim().length === 0) {
      throw new Error(`Playbook ${record.id || "(no id)"} has no ${field}`)
    }
  }
  return record
}

/** A playbook paired with its body, which is what `load_skill` hands back. */
export function skillOf(
  metas: readonly SkillMeta[],
  bodies: Record<string, string>
): Skill[] {
  const seen = new Set<string>()
  return metas.map((meta) => {
    if (seen.has(meta.id)) throw new Error(`Duplicate playbook id ${meta.id}`)
    seen.add(meta.id)
    const body = bodies[meta.id]
    if (body === undefined) throw new Error(`Playbook ${meta.id} has no body`)
    return defineSkill({ ...meta, body })
  })
}
