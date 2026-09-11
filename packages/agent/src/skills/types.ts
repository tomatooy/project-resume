/**
 * A playbook: prompt text about how to do something well.
 *
 * Nothing else. It has no schema, no `execute`, no whitelist and no
 * authority; loading one puts its `body` in the next step's context and
 * changes nothing about what the turn may do. That is the whole point of the
 * split: permission comes from the request, capability from the tool set.
 *
 * Bodies are static text rather than a function of the turn, because nothing
 * per-turn belongs in a playbook and a static body keeps a loaded playbook
 * byte-identical while the same prompt prefix is reused.
 */
export type Skill = {
  /** Stable id; recorded on the run and on the patch as attribution. */
  id: string
  /** Shown in the panel's chips and on the turn's opening line. */
  name: string
  /** One line for `find_skills` and the prompt index: when this playbook fits. */
  whenToUse: string
  /** One line: when it does not, so a near-miss is not loaded by mistake. */
  notFor: string
  /** What tapping the chip puts in the composer. Editable, never sent as-is. */
  starter: string
  /** The playbook itself. */
  body: string
}

/**
 * The client-safe half of a playbook: everything the panel needs and nothing
 * of the prompt. The catalog module holds these; the library adds bodies.
 */
export type SkillMeta = Omit<Skill, "body">
