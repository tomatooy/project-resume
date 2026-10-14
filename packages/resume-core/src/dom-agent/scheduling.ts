import type { RunIntent } from "./checkpoint"
import { DOM_AGENT_LIMITS } from "./limits"

/**
 * What to do next: how independent work is grouped, when a failed control is
 * retried, and what a fresh observation says about an action whose answer was
 * lost. All of it is arithmetic over evidence the caller already holds, so the
 * decisions are testable without a page.
 */

/**
 * What an action changes beyond the control it writes. Every one of these is
 * evidence the reader produced on the observation the action came from: whether
 * a selection reveals new controls is a fact about the page, not about the verb,
 * so the caller states it and this module never infers it.
 */
export type ActionEffect =
  | "record_group"
  | "option_discovery"
  | "upload_parsing"

export type PlannedAction = {
  actionRef: string
  questionRef: string
  /**
   * The evidence that this action changes what other questions are, or null.
   * An action with an effect ends its batch: the page it was planned against no
   * longer exists, so nothing else may be written from that observation.
   */
  effect: ActionEffect | null
  /**
   * Questions whose evidence this action changes. They are deferred and
   * re-planned against the next observation rather than reinterpreted with
   * everything else, which is what keeps a dynamic selection from turning into
   * a whole-page re-read.
   */
  affects: readonly string[]
}

export type BatchPlan = {
  index: number
  actions: PlannedAction[]
  closedBy: "effect" | "full" | "end"
  /**
   * Why the next batch needs to observe again, or null when it may run from the
   * observation this one already had. A full batch is a scheduling limit, not a
   * dependency, so it never forces a re-read on its own.
   */
  reobserve: ActionEffect | null
  /** Questions deferred because this batch changed their evidence. */
  affected: string[]
}

export function planBatches(input: {
  actions: readonly PlannedAction[]
  limit?: number
}): BatchPlan[] {
  const limit = input.limit ?? DOM_AGENT_LIMITS.actionsPerBatch
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("A batch needs a positive size")
  for (const action of input.actions)
    if (action.affects.length > 0 && action.effect === null)
      // An action cannot change another question's evidence without being able
      // to say what changed, and a batch boundary decided on a guess is exactly
      // what this module exists to avoid.
      throw new Error(
        `Action ${action.actionRef} affects other questions without an effect`
      )

  const batches: BatchPlan[] = []
  let current: PlannedAction[] = []
  let affected = new Set<string>()

  const close = (
    closedBy: BatchPlan["closedBy"],
    reobserve: ActionEffect | null
  ) => {
    if (current.length === 0) return
    batches.push({
      index: batches.length,
      actions: current,
      closedBy,
      reobserve,
      affected: [...affected],
    })
    current = []
    affected = new Set()
  }

  for (const action of input.actions) {
    current.push(action)
    for (const ref of action.affects) affected.add(ref)
    if (action.effect !== null) {
      close("effect", action.effect)
      continue
    }
    if (current.length >= limit) close("full", null)
  }
  close("end", null)
  return batches
}

/** What one attempt at a control looked like, so an identical retry is visible. */
export type CorrectionAttempt = {
  /** The page's own state at the attempt: a changed page is new evidence. */
  observationKey: string
  /** What the attempt did, so the same thing again is recognisable. */
  correction: string
  /**
   * What the page said when it refused. Kept beside the page's state rather
   * than inside it: two refusals of the same correction against one unchanged
   * page are one attempt repeated, and a retry needs something new to go on.
   */
  failure?: string | null
}

export type AttemptDecision =
  | { kind: "retry"; attempt: number }
  | { kind: "skip"; reason: "attempts_exhausted" | "no_new_evidence" }

/**
 * One initial action and at most two corrective attempts per failed control,
 * and a further attempt only with new evidence or a different justified
 * correction. Retrying the same correction against an unchanged page is how a
 * run turns one failure into a loop, and the count is per failed control:
 * successful independent writes never consume it.
 *
 * "Unchanged" is three things: the page, the correction, and what the page
 * said when it refused. The page is compared on its own state rather than on a
 * key that had a receipt folded into it, so an unchanged page reads as
 * unchanged; a refusal that changed is still a reason to try again.
 */
export function attemptPolicy(input: {
  attempts: number
  previous: CorrectionAttempt | null
  now: CorrectionAttempt
  max?: number
}): AttemptDecision {
  const max = input.max ?? DOM_AGENT_LIMITS.correctiveAttemptsPerControl
  if (input.attempts >= max)
    return { kind: "skip", reason: "attempts_exhausted" }
  const previous = input.previous
  if (previous) {
    const changedPage = previous.observationKey !== input.now.observationKey
    const differentCorrection = previous.correction !== input.now.correction
    const differentFailure =
      (previous.failure ?? null) !== (input.now.failure ?? null)
    if (!changedPage && !differentCorrection && !differentFailure)
      return { kind: "skip", reason: "no_new_evidence" }
  }
  return { kind: "retry", attempt: input.attempts + 1 }
}

/** What a fresh observation says about an action whose answer never arrived. */
export type RecoveryEvidence = {
  /** False when the page now on screen is a different application or document. */
  sameApplication: boolean
  /** False when the region the intent touched is not readable in this observation. */
  covered: boolean
  /** Record creation: how many groups the page holds now. */
  groupCount: number | null
  /** Upload: the attachment the field shows now, if any. */
  attachmentName: string | null
}

export type RecoveryVerdict =
  | { kind: "confirmed"; detail: string }
  | { kind: "retry"; detail: string }
  | { kind: "uncertain"; detail: string }

/**
 * Whether a dispatched action landed, decided by looking at the page rather
 * than by assuming either way. An unreadable region and a different application
 * both mean the question cannot be answered, and an unanswered question is
 * `uncertain`: that is a report a person can act on, where a guess is a
 * duplicate record or a second attachment.
 */
export function recoveryFor(input: {
  intent: RunIntent
  evidence: RecoveryEvidence
}): RecoveryVerdict {
  if (input.intent.settled === "confirmed")
    return { kind: "confirmed", detail: "A previous observation settled it" }
  if (input.intent.settled === "uncertain")
    return {
      kind: "uncertain",
      detail: "A previous observation could not tell",
    }
  if (!input.evidence.sameApplication)
    return {
      kind: "uncertain",
      detail: "The page is no longer the application this intent was made for",
    }
  if (!input.evidence.covered)
    return {
      kind: "uncertain",
      detail: "The region this action touched could not be read",
    }
  if (input.intent.kind === "record_creation") {
    const before = input.intent.groupCount
    const now = input.evidence.groupCount
    if (before === null || now === null)
      return { kind: "uncertain", detail: "The group count is not readable" }
    if (now > before)
      return {
        kind: "confirmed",
        detail: `The page holds ${now - before} more group(s) than before the action`,
      }
    return {
      kind: "retry",
      detail: "The page holds no more groups than before the action",
    }
  }
  // Nothing else can be decided by looking at the page. An upload is settled by
  // the receipt the page sent, and this point is unreachable from a run anyway:
  // the coordinator passes `covered: false` for every upload, because no
  // observation states what a file field holds. This reader reads attributes,
  // and a file input's selection is not an attribute, so there is nothing here
  // to compare and no retry the page could justify.
  return {
    kind: "uncertain",
    detail: "An upload cannot be judged from the page's own state",
  }
}
