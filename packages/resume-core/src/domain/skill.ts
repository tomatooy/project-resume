import type { NodeKind, PatchOp } from "@workspace/resume-schema"

/**
 * The registered AI capabilities, one row each.
 *
 * Everything both halves must agree on lives in this table: the op and field
 * whitelists `validatePatches` enforces (re-checked on the server when a
 * suggestion is accepted, so they cannot be client-side constants the browser
 * could contradict), whether a selection confines the skill, which skills are
 * live, what each needs from the user, and the label the picker shows. The
 * agent package adds the prompt; the app adds nothing.
 */
export type SkillId =
  | "bullet_rewrite"
  | "jd_match"
  | "grammar_clarity"
  | "condense_to_pages"
  | "ats_keyword"
  | "impact_quantification"
  | "summary_optimize"

/** A `phase2` skill is registered so its id is stable, but the route refuses it. */
export type SkillStatus = "mvp" | "phase2"

/** Inputs the route rejects a request without. */
export type SkillRequirement = "jobDescription" | "targetPages"

/** The tools a skill may call. `propose_patches` is always among them. */
export type SkillToolName = "check_fit" | "propose_patches"

export type SkillSpec = {
  id: SkillId
  label: string
  /** Shown in the picker tooltip and as the placeholder hint. */
  description: string
  status: SkillStatus
  /**
   * Whether a selection confines the skill.
   *
   * `node`: with a selection, patches must land inside the item that holds
   * it. `document`: the skill rewrites across the whole resume, so a
   * selection narrows what it is *shown* but never what it may change.
   * Confining `jd_match` to the selected bullet would stop it reordering
   * sections, which is most of what it does.
   */
  scope: "node" | "document"
  allowedOps: PatchOp[]
  /**
   * Narrows `textFields` further. A skill without this may write any text
   * field its target has.
   */
  allowedFields?: Partial<Record<NodeKind, string[]>>
  requires: SkillRequirement[]
  tools: SkillToolName[]
}

export const SKILL: Record<SkillId, SkillSpec> = {
  bullet_rewrite: {
    id: "bullet_rewrite",
    label: "Rewrite bullets",
    description: "Tighten wording without changing the facts.",
    status: "mvp",
    scope: "node",
    allowedOps: ["replace_text"],
    allowedFields: { bullet: ["text"] },
    requires: [],
    tools: ["propose_patches"],
  },
  jd_match: {
    id: "jd_match",
    label: "Match this JD",
    description: "Reorder and reword against a job description you paste in.",
    status: "mvp",
    scope: "document",
    allowedOps: ["replace_text", "move", "delete", "insert_after"],
    requires: ["jobDescription"],
    tools: ["propose_patches"],
  },
  grammar_clarity: {
    id: "grammar_clarity",
    label: "Grammar and clarity",
    description: "Fix grammar, tense and hedging language.",
    status: "mvp",
    scope: "node",
    allowedOps: ["replace_text"],
    requires: [],
    tools: ["propose_patches"],
  },
  condense_to_pages: {
    id: "condense_to_pages",
    label: "Cut to length",
    description: "Trim and merge until the resume fits a page target.",
    status: "mvp",
    scope: "document",
    allowedOps: ["replace_text", "delete", "move"],
    requires: ["targetPages"],
    tools: ["check_fit", "propose_patches"],
  },
  impact_quantification: {
    id: "impact_quantification",
    label: "Add metrics",
    description: "Ask for the numbers a bullet is missing.",
    status: "phase2",
    scope: "document",
    allowedOps: ["replace_text"],
    requires: [],
    tools: ["propose_patches"],
  },
  ats_keyword: {
    id: "ats_keyword",
    label: "Keyword coverage",
    description: "Surface terms the posting uses that the resume does not.",
    status: "phase2",
    scope: "document",
    allowedOps: ["replace_text", "update_fields", "insert_after"],
    requires: ["jobDescription"],
    tools: ["propose_patches"],
  },
  summary_optimize: {
    id: "summary_optimize",
    label: "Sharpen summary",
    description: "Rework the summary against the target role.",
    status: "phase2",
    scope: "document",
    allowedOps: ["replace_text", "update_fields"],
    requires: [],
    tools: ["propose_patches"],
  },
}

/** In the order the picker lists them. */
export const SKILLS: readonly SkillSpec[] = [
  SKILL.bullet_rewrite,
  SKILL.jd_match,
  SKILL.grammar_clarity,
  SKILL.condense_to_pages,
  SKILL.impact_quantification,
  SKILL.ats_keyword,
  SKILL.summary_optimize,
]

export function isSkillId(value: unknown): value is SkillId {
  return typeof value === "string" && value in SKILL
}

/**
 * The row for an id that arrived as a string: a stored patch's `skillId`, or
 * a request body. Undefined for `manual` and anything unregistered.
 */
export function skillOf(id: string): SkillSpec | undefined {
  return isSkillId(id) ? SKILL[id] : undefined
}

/**
 * Editor gestures build patches too, tagged `manual`. They never reach the
 * suggestion tables, but the stored patch keeps the tag, so anything reading
 * `patch.skillId` has to tolerate it.
 */
export const MANUAL_SKILL_ID = "manual"
