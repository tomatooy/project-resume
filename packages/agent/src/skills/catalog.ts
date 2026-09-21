import type { Skill, SkillMeta } from "./types"

export type { SkillMeta } from "./types"

/**
 * The playbook index: the rows without their bodies.
 *
 * This module deliberately imports nothing but the type, and the bodies stay
 * in `./playbooks`, which is what lets the library be assembled in `library.ts`
 * (`skillOf` pairs the two) while nothing here can drag prompt text along.
 */
export const SKILL_META: readonly SkillMeta[] = [
  {
    id: "bullet_rewrite",
    category: "editor",
    name: "Impact bullets",
    whenToUse:
      "Bullets should be tighter, verb-first and outcome-led; the user says improve, punchier, stronger, or asks for a rewrite.",
    notFor: "Cutting length, or matching a posting's wording.",
    starter:
      "Tighten my bullets so each one leads with what I did and changed.",
  },
  {
    id: "jd_match",
    category: "editor",
    name: "Match a posting",
    whenToUse:
      "The user pasted a job description into the message and the resume should speak to that role.",
    notFor: "A resume with no target role in view.",
    starter: "Match this resume to the job description.",
  },
  {
    id: "grammar_clarity",
    category: "editor",
    name: "Grammar and clarity",
    whenToUse:
      "The content is right but the grammar, tense, capitalization or phrasing needs work, or it reads like a duty list or AI filler rather than a resume.",
    notFor: "Rewriting for impact, cutting length, or adding content.",
    starter:
      "Fix the grammar and tense, and make it read like a resume, not AI filler.",
  },
  {
    id: "condense_to_pages",
    category: "editor",
    name: "Cut to length",
    whenToUse:
      "The user says the resume is too long, or asks what to cut to fit a length.",
    notFor: "Sharpening wording, or adding content.",
    starter: "Cut this down so it fits on one page.",
  },
  {
    id: "resume_quantifier",
    category: "editor",
    name: "Quantify impact",
    whenToUse:
      "Bullets read as duties with no figures, or the user asks to quantify the work, add metrics or numbers, or says they have no data.",
    notFor:
      "Cutting length, fixing grammar, or a rewrite that adds no figures.",
    starter: "Add numbers to my bullets so the size of the work comes through.",
  },
  {
    id: "tech_resume_optimizer",
    category: "editor",
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
 * The ids the catalog ships, for the evals and for `load_skill`'s `validIds`.
 * A plain string list: the wire and the panel both carry `string`, because a
 * stored hint may name a skill this release does not ship.
 */
export const SKILL_IDS: readonly string[] = SKILL_META.map((meta) => meta.id)

/** One line per playbook, the index the prompt and `find_skills` both read. */
export function skillIndexLines(skills: readonly Skill[]): string[] {
  return skills.map(
    (skill) => `- ${skill.id}: ${skill.name}. ${skill.whenToUse}`
  )
}
