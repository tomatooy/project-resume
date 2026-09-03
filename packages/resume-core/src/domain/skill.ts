import type { PatchOp } from "@workspace/resume-schema"

/**
 * The registered AI capabilities. What lives here is everything both halves
 * must agree on: the op whitelist `validatePatches` enforces (re-checked on
 * the server when a suggestion is accepted, so it cannot be a client-side
 * constant the browser could contradict), which skills are live, and what
 * each one needs from the user. Prompts and scoping live in `@workspace/agent`;
 * labels live in the app's picker.
 */
export type SkillId =
  | "bullet_rewrite"
  | "jd_match"
  | "grammar_clarity"
  | "condense_to_pages"
  | "ats_keyword"
  | "impact_quantification"
  | "summary_optimize"

export const SKILL_IDS: readonly SkillId[] = [
  "bullet_rewrite",
  "jd_match",
  "grammar_clarity",
  "condense_to_pages",
  "ats_keyword",
  "impact_quantification",
  "summary_optimize",
]

export const SKILL_ALLOWED_OPS: Record<SkillId, PatchOp[]> = {
  bullet_rewrite: ["replace_text"],
  jd_match: ["replace_text", "move", "delete", "insert_after"],
  grammar_clarity: ["replace_text"],
  condense_to_pages: ["replace_text", "delete", "move"],
  ats_keyword: ["replace_text", "update_fields", "insert_after"],
  impact_quantification: ["replace_text"],
  summary_optimize: ["replace_text", "update_fields"],
}

export type SkillStatus = "mvp" | "phase2"

/** A `phase2` skill is registered so its id is stable, but the route refuses it. */
export const SKILL_STATUS: Record<SkillId, SkillStatus> = {
  bullet_rewrite: "mvp",
  jd_match: "mvp",
  grammar_clarity: "mvp",
  condense_to_pages: "mvp",
  ats_keyword: "phase2",
  impact_quantification: "phase2",
  summary_optimize: "phase2",
}

export type SkillRequirement = "jobDescription" | "targetPages"

/** Inputs the route rejects a request without. */
export const SKILL_REQUIRES: Record<SkillId, SkillRequirement[]> = {
  bullet_rewrite: [],
  jd_match: ["jobDescription"],
  grammar_clarity: [],
  condense_to_pages: ["targetPages"],
  ats_keyword: ["jobDescription"],
  impact_quantification: [],
  summary_optimize: [],
}

export function isSkillId(value: unknown): value is SkillId {
  return typeof value === "string" && value in SKILL_ALLOWED_OPS
}

/**
 * Editor gestures build patches too, tagged `manual`. They never reach the
 * suggestion tables, but the stored patch keeps the tag, so anything reading
 * `patch.skillId` has to tolerate it.
 */
export const MANUAL_SKILL_ID = "manual"
