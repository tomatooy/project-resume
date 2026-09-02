import type { PatchOp } from "@workspace/resume-schema"

/**
 * The registered AI capabilities. Only the op whitelist lives here: it is the
 * rule `validatePatches` enforces, and it is re-checked on the server when a
 * suggestion is accepted, so it cannot be a client-side constant the browser
 * could contradict. Labels and availability stay in the app's picker.
 *
 * The prompts and scoping rules move into `packages/agent` when the model
 * layer lands; this table does not change when they do.
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

export function isSkillId(value: unknown): value is SkillId {
  return typeof value === "string" && value in SKILL_ALLOWED_OPS
}

/**
 * Editor gestures build patches too, tagged `manual`. They never reach the
 * suggestion tables, but the stored patch keeps the tag, so anything reading
 * `patch.skillId` has to tolerate it.
 */
export const MANUAL_SKILL_ID = "manual"
