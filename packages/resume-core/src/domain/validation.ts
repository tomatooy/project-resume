import {
  collectText,
  scopeAnchor,
  validatePatches,
  type Resume,
  type ValidationResult,
} from "@workspace/resume-schema"

import { AppError } from "./errors"
import {
  SKILL_ALLOWED_FIELDS,
  SKILL_ALLOWED_OPS,
  SKILL_SCOPE,
  isSkillId,
} from "./skill"

/**
 * Which of the two moments a patch is being checked at.
 *
 * `propose`: the model just produced it, against the document the model was
 * shown. Every rule applies.
 *
 * `reapply`: it was proposed earlier and the user is accepting it now, against
 * a head that may have moved. Grounding is the one rule that cannot run again,
 * because the user's message and the job description are not retained past the
 * run. Everything else still applies, including the `before` match that is
 * what makes a suggestion go stale.
 *
 * The distinction used to be expressed by handing `validatePatches` a
 * different grounding string at each call site, which meant the two modes
 * could drift apart without anything saying so, and they had: accept time
 * silently dropped the scope and field limits as well.
 */
export type ValidationMode =
  | {
      mode: "propose"
      skillId: string
      /** The user's selection, if any. Confines patches to what contains it. */
      selectedNodeId?: string
      userMessage: string
      jobDescription?: string
    }
  | {
      mode: "reapply"
      skillId: string
      /** The selection recorded on the run, which outlives the run's input. */
      selectedNodeId?: string
    }

/**
 * The skill is a server fact, not something the model states, so it is written
 * over whatever arrived. Anything that is not an object is left alone for the
 * shape check to reject.
 */
export function stampSkillId(patches: unknown[], skillId: string): unknown[] {
  return patches.map((patch) =>
    patch !== null && typeof patch === "object" ? { ...patch, skillId } : patch
  )
}

function limitsFor(skillId: string) {
  if (!isSkillId(skillId)) {
    throw new AppError("VALIDATION", `Unknown skill ${skillId}`)
  }
  return {
    allowedOps: SKILL_ALLOWED_OPS[skillId],
    allowedFields: SKILL_ALLOWED_FIELDS[skillId],
    scoped: SKILL_SCOPE[skillId] === "node",
  }
}

/**
 * The deterministic gate every model-proposed patch passes through, on the
 * server before persisting and again at accept time against the current head.
 *
 * Callers say which moment they are at and what the user gave them; the op
 * whitelist, the field whitelist, the scope anchor and the grounding text are
 * all derived here, from tables the browser cannot contradict.
 */
export function validateForSkill(
  resume: Resume,
  patches: unknown[],
  mode: ValidationMode
): ValidationResult {
  const { allowedOps, allowedFields, scoped } = limitsFor(mode.skillId)

  const scopeNodeId =
    scoped && mode.selectedNodeId
      ? scopeAnchor(resume, mode.selectedNodeId)?.id
      : undefined

  const groundingText =
    mode.mode === "propose"
      ? [
          mode.userMessage,
          mode.jobDescription ?? "",
          ...collectText(resume),
        ].join("\n")
      : null

  return validatePatches(resume, stampSkillId(patches, mode.skillId), {
    allowedOps,
    allowedFields,
    scopeNodeId,
    groundingText,
  })
}
