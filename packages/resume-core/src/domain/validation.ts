import {
  scopeAnchor,
  validatePatches,
  type Resume,
  type ValidationResult,
} from "@workspace/resume-schema"

import { AppError } from "./errors"
import { SKILL, isSkillId } from "./skill"

/**
 * Which of the two moments a patch is being checked at.
 *
 * `propose`: the model just produced it, against the document the model was
 * shown. `reapply`: it was proposed earlier and the user is accepting it now,
 * against a head that may have moved.
 *
 * The two modes now run the same rules; the distinction survives because the
 * scope anchor comes from the request when proposing and from the run row when
 * reapplying, and because a `before` mismatch is what makes a suggestion stale.
 */
export type ValidationMode =
  | {
      mode: "propose"
      skillId: string
      /** The user's selection, if any. Confines patches to what contains it. */
      selectedNodeId?: string
      userMessage: string
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
  const spec = SKILL[skillId]
  return {
    allowedOps: spec.allowedOps,
    allowedFields: spec.allowedFields,
    scoped: spec.scope === "node",
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

  return validatePatches(resume, stampSkillId(patches, mode.skillId), {
    allowedOps,
    allowedFields,
    scopeNodeId,
  })
}
