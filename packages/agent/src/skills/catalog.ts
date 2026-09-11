import type { SkillMeta } from "./types"

export type { SkillMeta } from "./types"

/**
 * The playbook index, and the only part of the library the browser loads.
 *
 * This module deliberately imports nothing but the type: the app renders
 * chip labels, tooltips and starter prompts from here, and the bodies stay in
 * `./playbooks`, which no client component reaches. That is why
 * `packages/agent/package.json` maps `./skills` to this file, not to the
 * library.
 */
export const SKILL_META: readonly SkillMeta[] = [
  {
    id: "bullet_rewrite",
    name: "Impact bullets",
    whenToUse:
      "Bullets should be tighter, verb-first and outcome-led; the user says improve, punchier, stronger, or asks for a rewrite.",
    notFor: "Cutting length, or matching a posting's wording.",
    starter:
      "Tighten my bullets so each one leads with what I did and changed.",
  },
  {
    id: "jd_match",
    name: "Match a posting",
    whenToUse:
      "The user pasted a job description into the message and the resume should speak to that role.",
    notFor: "A resume with no target role in view.",
    starter: "Match this resume to the job description.",
  },
  {
    id: "grammar_clarity",
    name: "Grammar and clarity",
    whenToUse:
      "The content is right but the grammar, tense, capitalization or phrasing needs work, or it reads like a duty list or AI filler rather than a resume.",
    notFor: "Rewriting for impact, cutting length, or adding content.",
    starter:
      "Fix the grammar and tense, and make it read like a resume, not AI filler.",
  },
  {
    id: "condense_to_pages",
    name: "Cut to length",
    whenToUse:
      "The user says the resume is too long, or asks what to cut to fit a length.",
    notFor: "Sharpening wording, or adding content.",
    starter: "Cut this down so it fits on one page.",
  },
  {
    id: "resume_quantifier",
    name: "Quantify impact",
    whenToUse:
      "Bullets read as duties with no figures, or the user asks to quantify the work, add metrics or numbers, or says they have no data.",
    notFor:
      "Cutting length, fixing grammar, or a rewrite that adds no figures.",
    starter: "Add numbers to my bullets so the size of the work comes through.",
  },
  {
    id: "tech_resume_optimizer",
    name: "Tech resume",
    whenToUse:
      "The target is a software, data, DevOps or technical PM role and the resume should read technical: the bullets, the skills groups, the projects and the links.",
    notFor:
      "Non-technical roles, or a general rewrite with no technical target.",
    starter:
      "Optimize this for a software engineering role: bullets, skills and projects.",
  },
] as const satisfies readonly SkillMeta[]

/**
 * The ids the catalog ships. A literal union for the panel's chips, so a chip
 * cannot name a playbook the library does not hold; the wire keeps `string`,
 * because a stored hint may come from an older release.
 */
export type SkillId = (typeof SKILL_META)[number]["id"]

/** Every playbook id, for `load_skill`'s `validIds` and the hint's validation. */
export const SKILL_IDS: readonly string[] = SKILL_META.map((meta) => meta.id)

/** The catalog row for an id, or undefined for a stored id from another shape. */
export function skillMetaOf(id: string): SkillMeta | undefined {
  return SKILL_META.find((meta) => meta.id === id)
}

/** One line per playbook, the index the prompt and `find_skills` both read. */
export function skillIndexLines(): string[] {
  return SKILL_META.map(
    (meta) => `- ${meta.id}: ${meta.name}. ${meta.whenToUse}`
  )
}
