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
 * The skill set from the over-all design, section 6.2. `allowedOps` is the
 * whitelist the patch validator enforces, so a skill can never make a change
 * outside what it was registered for.
 */
export const SKILLS: Skill[] = [
  {
    id: "bullet_rewrite",
    label: "Rewrite bullets",
    description: "Tighten wording without changing the facts.",
    allowedOps: ["replace_text"],
    available: true,
  },
  {
    id: "jd_match",
    label: "Match this JD",
    description: "Reorder and reword against a job description you paste in.",
    allowedOps: ["replace_text", "move", "delete", "insert_after"],
    available: true,
    needsJobDescription: true,
  },
  {
    id: "grammar_clarity",
    label: "Grammar and clarity",
    description: "Fix grammar, tense and hedging language.",
    allowedOps: ["replace_text"],
    available: true,
  },
  {
    id: "condense_to_pages",
    label: "Cut to length",
    description: "Trim and merge until the resume fits a page target.",
    allowedOps: ["replace_text", "delete", "move"],
    // Selectable because the page count behind it is real: `check-fit` renders
    // the proposed document and reads the count back from pdf.js.
    available: true,
    needsTargetPages: true,
  },
  {
    id: "impact_quantification",
    label: "Add metrics",
    description: "Ask for the numbers a bullet is missing.",
    allowedOps: ["replace_text"],
    available: false,
  },
  {
    id: "ats_keyword",
    label: "Keyword coverage",
    description: "Surface terms the posting uses that the resume does not.",
    allowedOps: ["replace_text", "update_fields", "insert_after"],
    available: false,
    needsJobDescription: true,
  },
  {
    id: "summary_optimize",
    label: "Sharpen summary",
    description: "Rework the summary against the target role.",
    allowedOps: ["replace_text", "update_fields"],
    available: false,
  },
]

export const skillById = new Map(SKILLS.map((skill) => [skill.id, skill]))

export const DEFAULT_SKILL: SkillId = "bullet_rewrite"
