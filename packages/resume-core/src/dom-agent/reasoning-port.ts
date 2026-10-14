import { z } from "zod"
import { DOM_AGENT_LIMITS } from "./limits"
import { ObservedOptionSchema, QuestionRefSchema } from "./primitives"
import type { ReconciledReasoning } from "./proposal-rules"
import { CandidateQuestionSchema } from "./question"
import { FactSchema } from "./source"

/**
 * The reasoning port. The loop that serves it lives in `@workspace/agent`; the
 * shape, the bounds and the rules over what comes back live here, because
 * nothing above this seam should depend on the model library.
 */

/**
 * What reasoning may ask the page for. Two kinds, both bounded: the text
 * around one question, or the options a control offers. There is no selector,
 * no script and no page mutation on this surface, so a read cannot become an
 * action, however the model phrases the request.
 */
export const ContextReadRequestSchema = z.strictObject({
  questionRef: QuestionRefSchema,
  kind: z.enum(["context", "options"]),
  /** A bounded hint for option discovery. Never a selector. */
  query: z.string().min(1).max(200).nullable(),
})

export const ContextReadSchema = z.strictObject({
  /** Page-authored text around the question. Untrusted data, never authority. */
  text: z.string().max(4000),
  /** Options the control offers, in the shape the driver already reports. */
  options: z.array(ObservedOptionSchema).max(200),
})

export type ContextReadRequest = z.infer<typeof ContextReadRequestSchema>
export type ContextRead = z.infer<typeof ContextReadSchema>

/**
 * One bounded request. The questions are the closed set: the model interprets
 * these and may not add, drop or rename one, which is what keeps the
 * completeness count deterministic.
 *
 * `facts` are the eligible facts of the pinned bundle, and the caller decides
 * eligibility. Facts are bounded by the bundle itself.
 */
export const ReasoningInputSchema = z.strictObject({
  questions: z
    .array(CandidateQuestionSchema)
    .min(1)
    .max(DOM_AGENT_LIMITS.questionsPerRequest),
  facts: z.array(FactSchema),
})

export type ReasoningInput = z.infer<typeof ReasoningInputSchema>

/**
 * How the loop ended. `completed` means the model returned an answer object,
 * not that every question was answered: what is left over is in `unresolved`.
 * `budget_exhausted` means the round ceiling ended it, and `failed` means no
 * usable output came back at all.
 */
export const ReasoningOutcomeSchema = z.enum([
  "completed",
  "budget_exhausted",
  "failed",
])

export type ReasoningOutcome = z.infer<typeof ReasoningOutcomeSchema>

export type ReasoningResult = ReconciledReasoning & {
  outcome: ReasoningOutcome
  /** Model rounds run, so the caller can record what the ceiling cost. */
  rounds: number
  /** Reads performed. A read the executor refused is not one. */
  contextReads: number
}

export type ReasonerOptions = {
  signal: AbortSignal
  /**
   * The only page access reasoning has. The caller performs it with the
   * driver, so a read is bounded twice: the executor counts it against the
   * per-question ceiling before asking, and the caller decides what a read of
   * that question even means.
   *
   * Null means the read produced nothing.
   */
  readContext: (request: ContextReadRequest) => Promise<ContextRead | null>
}

export interface PageReasoner {
  reason(
    input: ReasoningInput,
    options: ReasonerOptions
  ): Promise<ReasoningResult>
}
