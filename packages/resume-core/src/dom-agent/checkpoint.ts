import { z } from "zod"
import { QuestionRefSchema } from "./primitives"
import { ReceiptSchema } from "./receipt"
import { RunStateSchema } from "./run"
import { DOM_AGENT_LIMITS } from "./limits"

/**
 * What a run keeps between batches, and what it keeps across an interruption.
 *
 * A run is not a plan that survives: it is a recorded history of what was
 * dispatched, what the page confirmed, and what is still open. Nothing here is
 * a browser reference, so a checkpoint written before a navigation is still
 * readable after one, and nothing here is ever replayed as an action.
 */

/**
 * An action whose effect cannot be observed after the fact by looking at one
 * control. A lost response to one of these is the difference between one record
 * and two, or one attachment and a second upload, so the intent is written down
 * before the action leaves, not only after it returns.
 */
export const RunIntentKindSchema = z.enum(["record_creation", "upload"])
export type RunIntentKind = z.infer<typeof RunIntentKindSchema>

export const RunIntentSchema = z.strictObject({
  kind: RunIntentKindSchema,
  actionRef: z.string().min(1).max(32),
  questionRef: QuestionRefSchema,
  /** Record creation: how many groups the page held when this was recorded. */
  groupCount: z.number().int().nonnegative().nullable(),
  /** Upload: the attachment the field showed when this was recorded, if any. */
  attachmentName: z.string().max(300).nullable(),
  at: z.number().int().nonnegative(),
  /**
   * Set only by a fresh observation. `uncertain` is a real answer: it says the
   * page cannot tell the run whether the action landed, which is the one thing
   * that must never be guessed in either direction.
   */
  settled: z.enum(["confirmed", "uncertain"]).nullable(),
})
export type RunIntent = z.infer<typeof RunIntentSchema>

export const BatchRecordSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  actionRefs: z.array(z.string().min(1).max(32)).max(200),
  /** When every action in the batch left. Not when they were answered. */
  dispatchedAt: z.number().int().nonnegative(),
  settledAt: z.number().int().nonnegative().nullable(),
  /** What the page said, kept per question so a continue can re-validate it. */
  receipts: z.array(ReceiptSchema).max(200),
  /**
   * Why the batch after this one has to observe again, or null when it may run
   * from the observation this one already had.
   */
  reobserve: z
    .enum(["record_group", "option_discovery", "upload_parsing"])
    .nullable(),
})
export type BatchRecord = z.infer<typeof BatchRecordSchema>

/** What is known about a control that failed, so a retry can be judged. */
export const AttemptRecordSchema = z.strictObject({
  count: z.number().int().nonnegative(),
  /**
   * The page's own state at the last attempt, and nothing else. A receipt
   * folded in here would differ from the bare key the next decision compares
   * against, so every attempt would look like new evidence.
   */
  observationKey: z.string().max(200),
  /** What the last attempt did, so the same correction again is visible. */
  correction: z.string().max(200),
  /**
   * What the page said when it refused, so the same refusal is recognisable.
   * Optional because a checkpoint written before this existed has none, and an
   * unknown refusal is not the same as a known one.
   */
  failure: z.string().max(200).optional(),
})
export type AttemptRecord = z.infer<typeof AttemptRecordSchema>

export const RunCheckpointSchema = z.strictObject({
  runId: z.string().min(1).max(64),
  /** Account, tab and application together: the same host is not enough. */
  stateKey: z.string().min(1).max(300),
  state: RunStateSchema,
  sourceBundleId: z.string().min(1).max(64),
  documentGeneration: z.string().min(1).max(64),
  /**
   * Advances once per batch. A write at a revision the page already wrote is
   * refused as a replay, so a second pass over one document has to move this
   * forward or the page is right to refuse it.
   */
  questionRevision: z.number().int().nonnegative(),
  userEditEpoch: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative(),
  /**
   * Time the user, not the engine, was the blocker. Subtracted from the run
   * ceiling, because a run that waits for a person has not spent its budget.
   */
  waitedMs: z.number().int().nonnegative(),
  batches: z.array(BatchRecordSchema).max(200),
  intents: z.array(RunIntentSchema).max(200),
  /** Corrective attempts per question, so a failed control is not retried forever. */
  attempts: z.record(QuestionRefSchema, AttemptRecordSchema),
  /** Questions a batch deferred until a fresh observation can speak for them. */
  awaitingObservation: z.array(QuestionRefSchema).max(200),
  stopped: z
    .strictObject({
      kind: z.enum(["user", "connection", "ceiling", "interruption"]),
      reason: z.string().max(300),
      at: z.number().int().nonnegative(),
    })
    .nullable(),
})
export type RunCheckpoint = z.infer<typeof RunCheckpointSchema>

export function newCheckpoint(input: {
  runId: string
  stateKey: string
  sourceBundleId: string
  documentGeneration: string
  at: number
}): RunCheckpoint {
  return RunCheckpointSchema.parse({
    runId: input.runId,
    stateKey: input.stateKey,
    state: "observing",
    sourceBundleId: input.sourceBundleId,
    documentGeneration: input.documentGeneration,
    questionRevision: 1,
    userEditEpoch: 0,
    startedAt: input.at,
    waitedMs: 0,
    batches: [],
    intents: [],
    attempts: {},
    awaitingObservation: [],
    stopped: null,
  })
}

/** The intent an action needs written down before it is dispatched, if any. */
export function intentForAction(input: {
  kind: RunIntentKind
  actionRef: string
  questionRef: string
  groupCount: number | null
  attachmentName: string | null
  at: number
}): RunIntent {
  return RunIntentSchema.parse({
    kind: input.kind,
    actionRef: input.actionRef,
    questionRef: input.questionRef,
    groupCount: input.groupCount,
    attachmentName: input.attachmentName,
    at: input.at,
    settled: null,
  })
}

/** Time spent working, which is what the run ceiling governs. */
export function activeMs(checkpoint: RunCheckpoint, now: number): number {
  return Math.max(0, now - checkpoint.startedAt - checkpoint.waitedMs)
}

export type CeilingStatus =
  | { exhausted: false; activeMs: number; remainingMs: number }
  | { exhausted: true; reason: string; activeMs: number; remainingMs: 0 }

/**
 * The run ceiling. Reaching it is not a crash and not a completion: the caller
 * reports what is left and offers to continue, because stopping for a budget is
 * a state a person can act on and a claim of readiness is not.
 */
export function ceilingStatus(input: {
  checkpoint: RunCheckpoint
  now: number
  pageRunMs?: number
}): CeilingStatus {
  const limit = input.pageRunMs ?? DOM_AGENT_LIMITS.pageRunMs
  const used = activeMs(input.checkpoint, input.now)
  if (used >= limit)
    return {
      exhausted: true,
      reason: `The run used its ${Math.round(limit / 1000)} second budget`,
      activeMs: used,
      remainingMs: 0,
    }
  return { exhausted: false, activeMs: used, remainingMs: limit - used }
}

/**
 * What an exhausted run says. Deliberately not a readiness verdict: exhaustion
 * means the engine stopped, and `incomplete` with the outstanding questions and
 * an offer to continue is the only honest report for that.
 */
export function exhaustionReport(input: {
  remaining: readonly string[]
  reason: string
}): {
  state: "incomplete"
  reason: string
  remaining: string[]
  offerContinue: true
} {
  return {
    state: "incomplete",
    reason: input.reason,
    remaining: [...input.remaining],
    offerContinue: true,
  }
}

/** The outcome of an intent, once a fresh observation has spoken. */
export function settleIntent(
  checkpoint: RunCheckpoint,
  actionRef: string,
  settled: "confirmed" | "uncertain",
  at: number
): RunCheckpoint {
  return RunCheckpointSchema.parse({
    ...checkpoint,
    intents: checkpoint.intents.map((intent) =>
      intent.actionRef === actionRef ? { ...intent, settled } : intent
    ),
    batches: checkpoint.batches.map((batch) =>
      batch.actionRefs.includes(actionRef) && batch.settledAt === null
        ? { ...batch, settledAt: at }
        : batch
    ),
  })
}

/** Intents no observation has settled yet. A retry is decided against these. */
export function openIntents(checkpoint: RunCheckpoint): RunIntent[] {
  return checkpoint.intents.filter((intent) => intent.settled === null)
}

export function withBatch(
  checkpoint: RunCheckpoint,
  batch: BatchRecord
): RunCheckpoint {
  return RunCheckpointSchema.parse({
    ...checkpoint,
    questionRevision: checkpoint.questionRevision + 1,
    batches: [...checkpoint.batches, batch],
    awaitingObservation: [],
  })
}

export function withIntents(
  checkpoint: RunCheckpoint,
  intents: readonly RunIntent[]
): RunCheckpoint {
  if (intents.length === 0) return checkpoint
  return RunCheckpointSchema.parse({
    ...checkpoint,
    intents: [...checkpoint.intents, ...intents],
  })
}

export function withAttempt(
  checkpoint: RunCheckpoint,
  questionRef: string,
  input: { observationKey: string; correction: string; failure?: string }
): RunCheckpoint {
  const previous = checkpoint.attempts[questionRef]
  return RunCheckpointSchema.parse({
    ...checkpoint,
    attempts: {
      ...checkpoint.attempts,
      [questionRef]: {
        count: (previous?.count ?? 0) + 1,
        observationKey: input.observationKey,
        correction: input.correction,
        ...(input.failure === undefined ? {} : { failure: input.failure }),
      },
    },
  })
}

/**
 * The upload this run already wrote down for a question, if any. An upload is
 * the one action whose effect cannot be read from the control it wrote, so a
 * question that has one recorded is never uploaded again by the same run
 * without the user saying so.
 */
export function recordedUpload(
  checkpoint: RunCheckpoint,
  questionRef: string
): RunIntent | null {
  return (
    checkpoint.intents.find(
      (intent) => intent.kind === "upload" && intent.questionRef === questionRef
    ) ?? null
  )
}

/**
 * Resuming folds the time the user was the blocker into `waitedMs`, which is
 * what keeps a run that waited for a person from spending its ceiling while
 * nobody was working.
 */
export function withResume(
  checkpoint: RunCheckpoint,
  now: number
): RunCheckpoint {
  const stoppedAt = checkpoint.stopped?.at ?? now
  return RunCheckpointSchema.parse({
    ...checkpoint,
    state: "observing",
    stopped: null,
    waitedMs: checkpoint.waitedMs + Math.max(0, now - stoppedAt),
  })
}

/** Every receipt the run has, oldest first, so a continue can re-validate them. */
export function allReceipts(checkpoint: RunCheckpoint) {
  const receipts = []
  for (const batch of checkpoint.batches) receipts.push(...batch.receipts)
  return receipts
}

export function withStop(
  checkpoint: RunCheckpoint,
  input: {
    state: RunCheckpoint["state"]
    stopped: Omit<NonNullable<RunCheckpoint["stopped"]>, "at">
    at: number
  }
): RunCheckpoint {
  return RunCheckpointSchema.parse({
    ...checkpoint,
    state: input.state,
    stopped: { ...input.stopped, at: input.at },
  })
}
