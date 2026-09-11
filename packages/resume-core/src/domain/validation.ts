import {
  scopeAnchor,
  validatePatches,
  type Resume,
  type ValidationResult,
} from "@workspace/resume-schema"

/**
 * Which of the two moments a patch is being checked at.
 *
 * `propose`: the model just produced it, against the document the model was
 * shown. `reapply`: it was proposed earlier and the user is accepting it now,
 * against a head that may have moved.
 *
 * Both moments run the same rules. The distinction survives because the scope
 * anchor comes from the request when proposing and from the run row when
 * reapplying, and because the structural flag recorded on the run is what
 * makes accept-time validation agree with the check the patches were proposed
 * under even after the panel's toggle has changed.
 */
export type ValidationMode = {
  mode: "propose" | "reapply"
  /** The user asked for this turn to be able to restructure the document. */
  allowStructural: boolean
  /** The selection, if any. Confines patches to what contains it. */
  selectedNodeId?: string
}

/**
 * The deterministic gate every model-proposed patch passes through, on the
 * server before persisting and again at accept time against the current head.
 *
 * Callers say which moment they are at and what the user gave them. The
 * structural gate and the scope anchor are derived here, from the request and
 * the run row, never from anything the model states: per-patch `skillId` is
 * attribution and is not read. `validatePatches` owns correctness (shape,
 * target, `before`, field, dry run); this owns the two user-controlled bounds.
 */
export function validateForRun(
  resume: Resume,
  patches: unknown[],
  mode: ValidationMode
): ValidationResult {
  const scopeNodeId = mode.selectedNodeId
    ? scopeAnchor(resume, mode.selectedNodeId)?.id
    : undefined

  return validatePatches(resume, patches, {
    allowStructural: mode.allowStructural,
    scopeNodeId,
  })
}
