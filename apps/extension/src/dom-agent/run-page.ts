import {
  type AnswerProposal,
  type CandidateQuestion,
  type InterpretationCache,
  type ObservationCoverage,
  type Precondition,
  type QuestionDisposition,
  type QuestionPlan,
  type Receipt,
  type ReviewItem,
  type RunState,
  type SourceBundle,
  actionFor,
  dispositionFor,
  interpretPage,
  observationCoverage,
  planAnswers,
  reviewQueue,
  verifiedProgress,
} from "@workspace/resume-core/dom-agent"
import { type PageRead, observePage, readOptions } from "./observation"
import {
  type QuestionEnumeration,
  attachOptions,
  candidateQuestions,
} from "./questions"
import {
  type BundleLoader,
  dispatchParams,
  installParams,
  readInstall,
  releaseParams,
  remoteObjectId,
  remoteValue,
  replyFromCdpResult,
} from "./runtime-inject"
import { runtimeCall, type RuntimeCall } from "./runtime-request"
import { receiptFromReply } from "./runtime-receipt"
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
   * Advancing it per observation is the run coordinator's job; the first pass
   * over a fresh page is revision one.
   */
  questionRevision?: number
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
  const questions = await withPortalOptions({
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
  }
}

/**
 * Options that live in a portal belong to the control, not to a question of
 * their own, so they are read on request and attached to the question that
 * owns them. A read that fails leaves the question with the options the
 * observation already held.
 */
async function withPortalOptions(input: {
  session: DriverSession
  read: PageRead
  enumeration: QuestionEnumeration
}): Promise<CandidateQuestion[]> {
  const questions = [...input.enumeration.questions]
  for (const ref of input.enumeration.needingOptions) {
    const index = questions.findIndex((question) => question.ref === ref)
    const question = questions[index]
    if (!question) continue
    const read = await readOptions({
      session: input.session,
      read: input.read,
      controlRef: question.controlRef,
    })
    if (read.options.length > 0)
      questions[index] = attachOptions(question, read.options)
  }
  return questions
}

/**
 * Install the runtime in every context a question lives in. One install per
 * document: each frame has its own global, and a control in a frame is not
 * reachable through the top document's runtime.
 */
async function installRuntime(input: {
  session: DriverSession
  read: PageRead
  questions: readonly CandidateQuestion[]
  loadBundle: BundleLoader
}): Promise<Map<string, string>> {
  const keys = new Map<string, string>()
  const contexts: string[] = []
  for (const question of input.questions) {
    const identity = input.read.index.resolve(question.controlRef)
    if (identity && !contexts.includes(identity.contextId))
      contexts.push(identity.contextId)
  }
  if (contexts.length === 0) return keys
  const bundleText = await input.loadBundle()
  for (const contextId of contexts) {
    const result = await input.session.send(
      contextId,
      "Runtime.evaluate",
      installParams(bundleText)
    )
    const installation = readInstall(remoteValue(result))
    if (!installation)
      throw new Error(`The page runtime did not install in ${contextId}`)
    keys.set(contextId, installation.key)
  }
  return keys
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
  clock: () => number
}): Promise<{
  receipts: Receipt[]
  attempted: number
  notDispatchable: string[]
}> {
  const receipts: Receipt[] = []
  const notDispatchable: string[] = []
  let attempted = 0
  let counter = 0

  for (const question of input.questions) {
    const proposal = input.planned.proposals[question.ref]
    if (!proposal) continue
    const identity = input.read.index.resolve(question.controlRef)
    const key = identity ? input.keys.get(identity.contextId) : undefined
    if (!identity || !key) {
      notDispatchable.push(question.ref)
      continue
    }
    const node = input.read.observation.nodes.find(
      (candidate) => candidate.ref === question.controlRef
    )
    counter += 1
    const precondition = preconditionFor({
      contextId: identity.contextId,
      read: input.read,
      bundle: input.bundle,
      session: input.session,
      revision: input.revision,
    })
    const options = question.options.map((option) => ({
      ref: option.ref,
      label: option.label,
    }))
    const action = actionFor({
      actionRef: `a${counter}`,
      question,
      proposal,
      currentValue: node?.control?.value ?? null,
      precondition,
    })
    if (!action) {
      notDispatchable.push(question.ref)
      continue
    }
    const call = runtimeCall({
      action,
      precondition,
      options,
      // Attachments are a separate path: the bytes come from the pinned
      // bundle's rendering, and nothing here may claim to have them.
      attachment: null,
    })
    if (!call) {
      notDispatchable.push(question.ref)
      continue
    }
    attempted += 1
    receipts.push(
      await sendAction({
        session: input.session,
        contextId: identity.contextId,
        backendNodeId: identity.backendNodeId,
        key,
        actionRef: action.ref,
        questionRef: question.ref,
        call,
        options,
        at: input.clock(),
      })
    )
  }

  return { receipts, attempted, notDispatchable }
}

/**
 * What every action states about the moment it writes. `userEditEpoch` is
 * carried for the coordinator: the page compares it once something can move
 * it, and until then zero is the honest value.
 */
function preconditionFor(input: {
  contextId: string
  read: PageRead
  bundle: SourceBundle
  session: DriverSession
  revision: number
}): Precondition {
  const context = input.read.observation.contexts.find(
    (candidate) => candidate.id === input.contextId
  )
  return {
    documentGeneration: context?.generation ?? String(input.session.generation),
    questionRevision: input.revision,
    sourceBundleId: input.bundle.id,
    userEditEpoch: 0,
  }
}

async function sendAction(input: {
  session: DriverSession
  contextId: string
  backendNodeId: number
  key: string
  actionRef: string
  questionRef: string
  call: RuntimeCall
  options: readonly { ref: string; label: string }[]
  at: number
}): Promise<Receipt> {
  // The control is resolved from the observation's own identity, so a control
  // that was replaced since is a failure to resolve rather than a wrong write.
  const objectId = remoteObjectId(
    await input.session.send(input.contextId, "DOM.resolveNode", {
      backendNodeId: input.backendNodeId,
    })
  )
  if (!objectId)
    throw new Error(`The control for ${input.questionRef} did not resolve`)
  try {
    const result = await input.session.send(
      input.contextId,
      "Runtime.callFunctionOn",
      dispatchParams({
        key: input.key,
        elementObjectId: objectId,
        actionRef: input.actionRef,
        questionRef: input.questionRef,
        step: input.call.step,
        expect: input.call.expect,
      })
    )
    return receiptFromReply({
      actionRef: input.actionRef,
      questionRef: input.questionRef,
      reply: replyFromCdpResult(result),
      observedOptions: input.options,
      at: input.at,
    })
  } finally {
    await input.session.send(
      input.contextId,
      "Runtime.releaseObject",
      releaseParams(objectId)
    )
  }
}
