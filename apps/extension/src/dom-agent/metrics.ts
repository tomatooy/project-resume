import { z } from "zod"
import {
  RunStateSchema,
  activeMs,
  verifiedProgress,
  type Receipt,
  type RunCheckpoint,
} from "@workspace/resume-core/dom-agent"

/**
 * Timings and counts about one page run, and nothing else.
 *
 * The rule this feature lives under is that no applicant value, question
 * wording or document content reaches telemetry. Redaction is a promise a later
 * edit can quietly break, so this record is built the other way round: it has no
 * place to put a sentence. Every leaf is a number or a boolean, and the only
 * strings are two closed sets this module defines (the phase and the run state).
 * A caller cannot leak content into it by accident, and a caller cannot leak it
 * on purpose either: there is no free-text field to smuggle it through. The
 * suite proves that by walking records rather than by trusting this comment.
 *
 * A run is identified by the ordinal the ring stamps and the time it was
 * recorded, rather than by a name. A name would be a string door, and the only
 * thing a name buys here is correlation, which the ordinal already gives.
 */
export const RunMetricsSchema = z.strictObject({
  /** Local clock reading when the record was written. */
  at: z.number().int().nonnegative(),
  /** Cold is the first pass over a page; warm reuses what that pass built. */
  phase: z.enum(["cold", "warm"]),
  /** The run's state, from a closed set. */
  state: RunStateSchema,
  /**
   * Start of the run to the first write the page confirmed. Null when nothing
   * was confirmed, which is not the same as zero.
   */
  firstVerifiedFillMs: z.number().int().nonnegative().nullable(),
  /**
   * Working time, excluding the time the user was the blocker. A run that waits
   * for a person has not spent its budget, so waiting must not be measured as
   * slowness.
   */
  completionMs: z.number().int().nonnegative().nullable(),
  /** Full page reads this run performed. */
  observations: z.number().int().nonnegative(),
  /** Bytes of the observation the reader produced, as it would be sent. */
  observationBytes: z.number().int().nonnegative().nullable(),
  /** Questions this pass planned and wrote. A continue's inherited batches are
   * not counted: those questions were planned by the pass that wrote them. */
  plannedQuestions: z.number().int().nonnegative(),
  /** Plans in this pass for a question an earlier batch had already planned. */
  replannedQuestions: z.number().int().nonnegative(),
  /** Writes the page refused, or that nothing confirmed. */
  verificationFailures: z.number().int().nonnegative(),
  /** Model calls and the tokens they reported. Zero is a result, not a gap. */
  modelRequests: z.number().int().nonnegative(),
  modelTokens: z.number().int().nonnegative(),
  /** Whether the run could read the whole page. */
  coverageComplete: z.boolean(),
  coverageGaps: z.number().int().nonnegative(),
  /** The run's own counts, already content-free. */
  accepted: z.number().int().nonnegative(),
  /**
   * Writes the run holds a receipt for, which includes receipts carried from an
   * earlier pass. It is the run's own number, not a count of sends: a continue
   * that validates what it already holds reports them here too.
   */
  dispatched: z.number().int().nonnegative(),
  unresolved: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /**
   * Questions waiting on a person. Separate from `unresolved`, which counts
   * writes nothing confirmed: a question nobody answered was never written.
   */
  awaitingInput: z.number().int().nonnegative(),
})

export type RunMetrics = z.infer<typeof RunMetricsSchema>

/** A stored record is a record plus the ring's own ordinal. */
export const StoredRunMetricsSchema = RunMetricsSchema.extend({
  sequence: z.number().int().positive(),
})

export type StoredRunMetrics = z.infer<typeof StoredRunMetricsSchema>

/** How many runs are kept. Old runs are dropped, never written to disk. */
export const METRICS_RING_SIZE = 50

/**
 * A bounded buffer in memory. Nothing here is persisted or sent anywhere: the
 * point of a local ring is that the privacy question never reaches a network.
 */
export class RunMetricsRing {
  private readonly records: StoredRunMetrics[] = []
  private written = 0

  constructor(private readonly capacity: number = METRICS_RING_SIZE) {}

  record(metrics: RunMetrics): void {
    const parsed = RunMetricsSchema.parse(metrics)
    this.written += 1
    // Validated on the way in, so what a reader walks is exactly this shape.
    this.records.push(
      StoredRunMetricsSchema.parse({ ...parsed, sequence: this.written })
    )
    while (this.records.length > this.capacity) this.records.shift()
  }

  /** The ordinal the ring assigned, so a reader can order what it sees. */
  entries(): readonly StoredRunMetrics[] {
    return this.records
  }

  clear(): void {
    this.records.length = 0
  }
}

/** The buffer a run in this worker writes to. */
export const runMetricsRing = new RunMetricsRing()

/**
 * The size of a value as it would cross a wire. Used for the observation
 * payload, which is the one measurement that is a size rather than a count.
 */
export function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

/** What a caller has to hand over, shaped to keep this module a leaf. */
export type RunMetricsInput = {
  phase: "cold" | "warm"
  now: number
  state: RunMetrics["state"]
  receipts: readonly Receipt[]
  coverage: { complete: boolean; gaps: readonly unknown[] }
  checkpoint: RunCheckpoint
  observations: number
  observationBytes: number | null
  plannedQuestions: number
  replannedQuestions: number
  /** Questions the run left for the user. */
  awaitingInput: number
  model?: { requests: number; tokens: number }
}

/**
 * Turn what a finished run already reports into one record. Reading the run's
 * own numbers is deliberate: a metric computed from a second source could
 * disagree with the receipt the user was shown, and then both would be wrong.
 */
export function runMetrics(input: RunMetricsInput): RunMetrics {
  const progress = verifiedProgress(input.receipts)
  let firstVerifiedFillMs: number | null = null
  for (const receipt of input.receipts) {
    if (receipt.state !== "accepted") continue
    const elapsed = receipt.at - input.checkpoint.startedAt
    const clamped = elapsed > 0 ? elapsed : 0
    if (firstVerifiedFillMs === null || clamped < firstVerifiedFillMs)
      firstVerifiedFillMs = clamped
  }
  return RunMetricsSchema.parse({
    at: input.now,
    phase: input.phase,
    state: input.state,
    firstVerifiedFillMs,
    completionMs: activeMs(input.checkpoint, input.now),
    observations: input.observations,
    observationBytes: input.observationBytes,
    plannedQuestions: input.plannedQuestions,
    replannedQuestions: input.replannedQuestions,
    verificationFailures: progress.failed,
    modelRequests: input.model?.requests ?? 0,
    modelTokens: input.model?.tokens ?? 0,
    coverageComplete: input.coverage.complete,
    coverageGaps: input.coverage.gaps.length,
    accepted: progress.accepted,
    dispatched: input.receipts.length,
    unresolved: progress.unresolved,
    failed: progress.failed,
    awaitingInput: input.awaitingInput,
  })
}

/**
 * The dev-only view. Built from the record's own fields, so it cannot show
 * anything the record does not hold, and the record holds no content.
 */
export function metricsReadout(entries: readonly StoredRunMetrics[]): string[] {
  return entries.map((entry) => {
    const first =
      entry.firstVerifiedFillMs === null
        ? "none"
        : `${entry.firstVerifiedFillMs}ms`
    const payload =
      entry.observationBytes === null ? "none" : `${entry.observationBytes}B`
    return [
      `#${entry.sequence}`,
      entry.phase,
      entry.state,
      `fill ${entry.accepted}/${entry.dispatched}`,
      `waiting ${entry.awaitingInput}`,
      `unresolved ${entry.unresolved}`,
      `failed ${entry.failed}`,
      `first ${first}`,
      `work ${entry.completionMs}ms`,
      `obs ${entry.observations} ${payload}`,
      `planned ${entry.plannedQuestions} replanned ${entry.replannedQuestions}`,
      `model ${entry.modelRequests}/${entry.modelTokens}`,
      entry.coverageComplete
        ? "coverage complete"
        : `coverage gaps ${entry.coverageGaps}`,
    ].join(" | ")
  })
}

/**
 * The readout exists to be looked at by a developer, so a production build gets
 * nothing rather than a weaker version of the same surface.
 */
export function devMetricsReadout(): string[] | null {
  if (!import.meta.env.DEV) return null
  return metricsReadout(runMetricsRing.entries())
}
