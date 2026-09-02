import { SKILL_ALLOWED_OPS } from "@workspace/resume-core"
import type { PatchOp } from "@workspace/resume-schema"

import type { SkillId } from "./types"

export type Skill = {
  id: SkillId
  label: string
  /** Shown in the picker tooltip and as the placeholder hint. */
  description: string
  allowedOps: PatchOp[]
  /** MVP skills are selectable; the rest are listed but disabled. */
  available: boolean
  needsJobDescription?: boolean
  needsTargetPages?: boolean
}

/**
 * The skill set from the over-all design, section 6.2.
 *
 * `allowedOps` is not declared here. It comes from `SKILL_ALLOWED_OPS` in
 * `resume-core`, which is the same table the server re-applies when a
 * suggestion is accepted. Two copies would drift, and the copy that matters is
 * the server's: a browser that widened its own list would simply have its
 * patches refused, with no way to see why.
 */
const CATALOGUE: Omit<Skill, "allowedOps">[] = [
  {
    id: "bullet_rewrite",
    label: "Rewrite bullets",
    description: "Tighten wording without changing the facts.",
    available: true,
  },
  {
    id: "jd_match",
    label: "Match this JD",
    description: "Reorder and reword against a job description you paste in.",
    available: true,
    needsJobDescription: true,
  },
  {
    id: "grammar_clarity",
    label: "Grammar and clarity",
    description: "Fix grammar, tense and hedging language.",
    available: true,
  },
  {
    id: "condense_to_pages",
    label: "Cut to length",
    description: "Trim and merge until the resume fits a page target.",
    // Selectable because the page count behind it is real: `check-fit` renders
    // the proposed document and reads the count back from pdf.js.
    available: true,
    needsTargetPages: true,
  },
  {
    id: "impact_quantification",
    label: "Add metrics",
    description: "Ask for the numbers a bullet is missing.",
    available: false,
  },
  {
    id: "ats_keyword",
    label: "Keyword coverage",
    description: "Surface terms the posting uses that the resume does not.",
    available: false,
    needsJobDescription: true,
  },
  {
    id: "summary_optimize",
    label: "Sharpen summary",
    description: "Rework the summary against the target role.",
    available: false,
  },
]

export const SKILLS: Skill[] = CATALOGUE.map((skill) => ({
  ...skill,
  allowedOps: SKILL_ALLOWED_OPS[skill.id],
}))

export const skillById = new Map(SKILLS.map((skill) => [skill.id, skill]))

export const DEFAULT_SKILL: SkillId = "bullet_rewrite"
