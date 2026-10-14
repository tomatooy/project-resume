import {
  type Action,
  type AnswerProposal,
  type CandidateQuestion,
  type Precondition,
  type Receipt,
  type SourceBundle,
  actionFor,
} from "@workspace/resume-core/dom-agent"
import { type PageRead, readOptions } from "./observation"
import { type QuestionEnumeration, attachOptions } from "./questions"
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
import {
  type ObservedOptionRef,
  type RenderedAttachment,
  type RuntimeCall,
  runtimeCall,
} from "./runtime-request"
import { receiptFromReply } from "./runtime-receipt"
import type { DriverSession } from "./session"

/**
 * The steps one page run is made of, shared by the single-pass deterministic
 * path and the coordinator. Both observe, install, and write through the same
 * code, so a rule about how a control is addressed or how a reply becomes a
 * receipt has one implementation rather than two that can drift apart.
 */

/**
 * Options that live in a portal belong to the control, not to a question of
 * their own, so they are read on request and attached to the question that owns
 * them. A read that fails leaves the question with the options the observation
 * already held.
 */
export async function attachPortalOptions(input: {
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
export async function installRuntime(input: {
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
 * What every action states about the moment it writes. The revision and the
 * user-edit epoch are the coordinator's, because only it knows which pass the
 * action belongs to and what the page reported since.
 */
export function preconditionFor(input: {
  contextId: string
  read: PageRead
  bundle: SourceBundle
  session: DriverSession
  revision: number
  userEditEpoch: number
}): Precondition {
  const context = input.read.observation.contexts.find(
    (candidate) => candidate.id === input.contextId
  )
  return {
    documentGeneration: context?.generation ?? String(input.session.generation),
    questionRevision: input.revision,
    sourceBundleId: input.bundle.id,
    userEditEpoch: input.userEditEpoch,
  }
}

export type WriteAttempt =
  | {
      kind: "receipt"
      receipt: Receipt
      /** The page's edit count, or null when the reply could not be read. */
      userEditEpoch: number | null
    }
  /** The observation cannot express this action, so nothing was dispatched. */
  | { kind: "not_dispatchable" }
  /** The question lives in a context this run has no runtime in. */
  | { kind: "no_runtime" }

/**
 * One action, written through the runtime the worker installed. The control is
 * resolved from the observation's own identity, so a control that was replaced
 * since is a failure to resolve rather than a wrong write.
 */
export async function writeOne(input: {
  session: DriverSession
  read: PageRead
  question: CandidateQuestion
  proposal: AnswerProposal
  actionRef: string
  keys: Map<string, string>
  bundle: SourceBundle
  revision: number
  userEditEpoch: number
  attachment: RenderedAttachment | null
  at: number
}): Promise<WriteAttempt> {
  const identity = input.read.index.resolve(input.question.controlRef)
  const key = identity ? input.keys.get(identity.contextId) : undefined
  if (!identity || !key) return { kind: "no_runtime" }
  const node = input.read.observation.nodes.find(
    (candidate) => candidate.ref === input.question.controlRef
  )
  const precondition = preconditionFor({
    contextId: identity.contextId,
    read: input.read,
    bundle: input.bundle,
    session: input.session,
    revision: input.revision,
    userEditEpoch: input.userEditEpoch,
  })
  const action = actionFor({
    actionRef: input.actionRef,
    question: input.question,
    proposal: input.proposal,
    currentValue: node?.control?.value ?? null,
    precondition,
  })
  if (!action) return { kind: "not_dispatchable" }
  return dispatchAction({
    session: input.session,
    read: input.read,
    question: input.question,
    action,
    keys: input.keys,
    bundle: input.bundle,
    revision: input.revision,
    userEditEpoch: input.userEditEpoch,
    attachment: input.attachment,
    at: input.at,
  })
}

/**
 * One action already built by the caller, sent to the control the observation
 * holds. An action the caller assembled itself (an attachment, a record group)
 * goes through the same runtime call and becomes the same kind of receipt as
 * one the deterministic tier produced, so nothing about how it is verified
 * depends on where it came from.
 */
export async function dispatchAction(input: {
  session: DriverSession
  read: PageRead
  question: CandidateQuestion
  action: Action
  keys: Map<string, string>
  bundle: SourceBundle
  revision: number
  userEditEpoch: number
  attachment: RenderedAttachment | null
  at: number
}): Promise<WriteAttempt> {
  const identity = input.read.index.resolve(input.question.controlRef)
  const key = identity ? input.keys.get(identity.contextId) : undefined
  if (!identity || !key) return { kind: "no_runtime" }
  const precondition = preconditionFor({
    contextId: identity.contextId,
    read: input.read,
    bundle: input.bundle,
    session: input.session,
    revision: input.revision,
    userEditEpoch: input.userEditEpoch,
  })
  const options: ObservedOptionRef[] = input.question.options.map((option) => ({
    ref: option.ref,
    label: option.label,
  }))
  const call = runtimeCall({
    action: input.action,
    precondition,
    options,
    attachment: input.attachment,
  })
  if (!call) return { kind: "not_dispatchable" }
  const receipt = await sendAction({
    session: input.session,
    contextId: identity.contextId,
    backendNodeId: identity.backendNodeId,
    key,
    actionRef: input.action.ref,
    questionRef: input.question.ref,
    call,
    options,
    at: input.at,
  })
  return {
    kind: "receipt",
    receipt: receipt.receipt,
    userEditEpoch: receipt.userEditEpoch,
  }
}

/**
 * A receipt, and the page's edit count if the reply was readable at all. The
 * count is what the next action has to state, so a reply that could not be read
 * leaves it unknown rather than resetting the worker's view of the page.
 */
async function sendAction(input: {
  session: DriverSession
  contextId: string
  backendNodeId: number
  key: string
  actionRef: string
  questionRef: string
  call: RuntimeCall
  options: readonly ObservedOptionRef[]
  at: number
}): Promise<{ receipt: Receipt; userEditEpoch: number | null }> {
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
    const reply = replyFromCdpResult(result)
    return {
      receipt: receiptFromReply({
        actionRef: input.actionRef,
        questionRef: input.questionRef,
        reply,
        observedOptions: input.options,
        at: input.at,
      }),
      userEditEpoch: reply?.ok ? reply.userEditEpoch : null,
    }
  } finally {
    await input.session.send(
      input.contextId,
      "Runtime.releaseObject",
      releaseParams(objectId)
    )
  }
}
