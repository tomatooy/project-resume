import {
  SKILL_ALLOWED_OPS,
  SKILL_REQUIRES,
  SKILL_STATUS,
} from "@workspace/resume-core"
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
  needsJobDescription: boolean
  needsTargetPages: boolean
}

/**
 * The skill set from the over-all design, section 6.2. Only the labels live
 * here. Which ops a skill may use, whether it has shipped, and what it needs
 * from the user all come from `resume-core`, because those are the facts the
 * route enforces: a picker that disagreed with them would only produce
 * requests the server refuses, with no way to see why.
 */
const LABELS: Record<SkillId, { label: string; description: string }> = {
  bullet_rewrite: {
    label: "Rewrite bullets",
    description: "Tighten wording without changing the facts.",
  },
  jd_match: {
    label: "Match this JD",
    description: "Reorder and reword against a job description you paste in.",
  },
  grammar_clarity: {
    label: "Grammar and clarity",
    description: "Fix grammar, tense and hedging language.",
  },
  condense_to_pages: {
    label: "Cut to length",
    description: "Trim and merge until the resume fits a page target.",
  },
  impact_quantification: {
    label: "Add metrics",
    description: "Ask for the numbers a bullet is missing.",
  },
  ats_keyword: {
    label: "Keyword coverage",
    description: "Surface terms the posting uses that the resume does not.",
  },
  summary_optimize: {
    label: "Sharpen summary",
    description: "Rework the summary against the target role.",
  },
}

const ORDER: SkillId[] = [
  "bullet_rewrite",
  "jd_match",
  "grammar_clarity",
  "condense_to_pages",
  "impact_quantification",
  "ats_keyword",
  "summary_optimize",
]

export const SKILLS: Skill[] = ORDER.map((id) => ({
  id,
  ...LABELS[id],
  allowedOps: SKILL_ALLOWED_OPS[id],
  available: SKILL_STATUS[id] === "mvp",
  needsJobDescription: SKILL_REQUIRES[id].includes("jobDescription"),
  needsTargetPages: SKILL_REQUIRES[id].includes("targetPages"),
}))

export const skillById = new Map(SKILLS.map((skill) => [skill.id, skill]))

export const DEFAULT_SKILL: SkillId = "bullet_rewrite"
