import {
  type AnswerProposal,
  type CandidateQuestion,
  type InterpretationCache,
  type ObservationCoverage,
  type QuestionDisposition,
  type QuestionPlan,
  type Receipt,
  type ReviewItem,
  type RunState,
  type SourceBundle,
  dispositionFor,
  interpretPage,
  observationCoverage,
  planAnswers,
  reviewQueue,
  verifiedProgress,
} from "@workspace/resume-core/dom-agent"
import { type PageRead, observePage } from "./observation"
import { candidateQuestions } from "./questions"
import { attachPortalOptions, installRuntime, writeOne } from "./page-steps"
import type { BundleLoader } from "./runtime-inject"
import type { DriverSession } from "./session"

/**
 * One page run down the deterministic path: observe the page, enumerate its
 * questions, answer the ones a fact already matches, write them through the
 * page runtime, and report what the page confirmed.
 *
 * The model is not on this path at all. What is not matched here stays
 * unresolved and visible, and no count of dispatched actions stands in for a
 * count of confirmed ones: a write the page did not accept is a question the
 * user still has to answer.
 *
 * The run never claims the page is ready. Readiness is the audit's decision
 * (a later ticket), so the furthest this path goes is `auditing`.
 *
 * This is one pass with no memory: the coordinator beside it keeps the
 * checkpoint, the batching and the recovery, and calls the same steps.
 */

export type PageFillResult = {
  observation: PageRead["observation"]
  questions: CandidateQuestion[]
  plans: QuestionPlan[]
  proposals: Record<string, AnswerProposal>
  receipts: Receipt[]
  /** One per question, decided by its receipt when there is one. */
  dispositions: Record<string, QuestionDisposition>
  review: ReviewItem[]
  progress: {
    /** Confirmed by the page. The only count that means filled. */
    accepted: number
    unresolved: number
    failed: number
    /** Attempted, whatever came back. Shown beside the rest, never instead. */
    dispatched: number
  }
  coverage: ObservationCoverage
  state: RunState
  /** What the interpreter reused and what it had to read. */
  interpreted: { reused: string[]; interpreted: string[] }
  /** The page's own edit count, as its last reply reported it. */
  userEditEpoch: number
}

export async function fillCurrentPage(input: {
  session: DriverSession
  bundle: SourceBundle
  /** The built page runtime, read from the extension's own package. */
  loadBundle: BundleLoader
  /** Carried across observations so an unchanged question is read once. */
  cache?: InterpretationCache
  /**
   * The revision every action in this pass states for its question. The page
   * refuses a write at or below the revision it already wrote, so a second
   * pass over the same document must advance this or be refused as a replay.
   * Advancing it is the run coordinator's job; the first pass over a fresh page
   * is revision one.
   */
  questionRevision?: number
  /** What the page reported for the user's own edits, if anything has. */
  userEditEpoch?: number
  clock?: () => number
}): Promise<PageFillResult> {
  const clock = input.clock ?? (() => Date.now())
  const session = input.session
  const facts = input.bundle.facts

  const read = await observePage({ session })
  const enumeration = candidateQuestions({
    observation: read.observation,
    evidence: read.evidence,
    regions: read.regions,
    records: read.records,
  })
  const questions = await attachPortalOptions({
    session,
    read,
    enumeration,
  })

  const interpretations = interpretPage({
    questions,
    facts,
    cache: input.cache,
  })
  const planned = planAnswers({
    questions,
    facts,
    seeds: enumeration.dispositions,
    interpretations: interpretations.byRef,
  })

  const keys = await installRuntime({
    session,
    read,
    questions,
    loadBundle: input.loadBundle,
  })
  const written = await writeAnswers({
    session,
    read,
    questions,
    planned,
    keys,
    bundle: input.bundle,
    revision: input.questionRevision ?? 1,
    userEditEpoch: input.userEditEpoch ?? 0,
    clock,
  })

  const dispositions: Record<string, QuestionDisposition> = {}
  const receiptByRef = new Map(
    written.receipts.map((receipt) => [receipt.questionRef, receipt])
  )
  const planByRef = new Map(
    planned.plans.map((plan) => [plan.questionRef, plan])
  )
  for (const question of questions) {
    const plan = planByRef.get(question.ref)
    if (!plan) continue
    dispositions[question.ref] = dispositionFor(
      plan,
      receiptByRef.get(question.ref)
    )
  }

  const review = reviewQueue({
    questions,
    plans: planned.plans,
    receipts: written.receipts,
    notDispatchable: written.notDispatchable,
  })
  const coverage = observationCoverage(
    [...read.observation.coverage.gaps, ...enumeration.gaps],
    read.observation.coverage.complete
  )
  const verified = verifiedProgress(written.receipts)

  return {
    observation: read.observation,
    questions,
    plans: planned.plans,
    proposals: planned.proposals,
    receipts: written.receipts,
    dispositions,
    review,
    progress: {
      accepted: verified.accepted,
      unresolved: verified.unresolved,
      failed: verified.failed,
      dispatched: written.attempted,
    },
    coverage,
    // Independent work is finished, so the page is ready for the audit and
    // nothing more. A required answer still outstanding is the user's.
    state: review.some((item) => item.blocking) ? "needs_input" : "auditing",
    interpreted: {
      reused: interpretations.reused,
      interpreted: interpretations.interpreted,
    },
    userEditEpoch: written.userEditEpoch,
  }
}

/**
 * Write one action per accepted proposal, in document order, and turn each
 * reply into a receipt. Nothing is batched here: a batch is a scheduling
 * decision, and the receipts are what the count is built from either way.
 */
async function writeAnswers(input: {
  session: DriverSession
  read: PageRead
  questions: readonly CandidateQuestion[]
  planned: { plans: QuestionPlan[]; proposals: Record<string, AnswerProposal> }
  keys: Map<string, string>
  bundle: SourceBundle
  revision: number
  userEditEpoch: number
  clock: () => number
}): Promise<{
  receipts: Receipt[]
  attempted: number
  notDispatchable: string[]
  userEditEpoch: number
}> {
  const receipts: Receipt[] = []
  const notDispatchable: string[] = []
  let attempted = 0
  let counter = 0
  let userEditEpoch = input.userEditEpoch

  for (const question of input.questions) {
    const proposal = input.planned.proposals[question.ref]
    if (!proposal) continue
    counter += 1
    const attempt = await writeOne({
      session: input.session,
      read: input.read,
      question,
      proposal,
      actionRef: `a${counter}`,
      keys: input.keys,
      bundle: input.bundle,
      revision: input.revision,
      userEditEpoch,
      // Attachments are a separate path: the bytes come from the pinned
      // bundle's rendering, and nothing here may claim to have them.
      attachment: null,
      at: input.clock(),
    })
    if (attempt.kind === "receipt") {
      attempted += 1
      receipts.push(attempt.receipt)
      if (attempt.userEditEpoch !== null) userEditEpoch = attempt.userEditEpoch
      continue
    }
    notDispatchable.push(question.ref)
  }

  return { receipts, attempted, notDispatchable, userEditEpoch }
}
