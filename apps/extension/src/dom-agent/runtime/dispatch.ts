import {
  RUNTIME_EVIDENCE,
  RUNTIME_VERSION,
  emptyObserved,
  isRuntimeVerb,
  readExpectation,
  readStep,
  type RuntimeEvidenceCode,
  type RuntimeExpectation,
  type RuntimeOutcome,
  type RuntimeReply,
  type RuntimeReplyBody,
  type RuntimeStep,
  type RuntimeVerb,
} from "./protocol"
import {
  addRecordGroup,
  attachFile,
  discoverOptions,
  outcome,
  readControl,
  selectOption,
  toggle,
  writeText,
} from "./verbs"

/**
 * Per-document state the page keeps for the duration of one installed runtime.
 * Everything here survives across calls, which is what makes it able to notice
 * a request that belongs to an older state of the page.
 */
export type RuntimeState = {
  /** The bundle id fixed for this application, established by the first call. */
  bundleId: string | null
  /**
   * The document generation this runtime was installed for, established by the
   * first call. A request that states another one is addressing a document this
   * runtime does not live in.
   */
  documentGeneration: string | null
  /**
   * How many times the user has edited this page since the runtime was
   * installed. A request states the epoch it was planned against, so an edit
   * between planning and writing is refused rather than written over.
   */
  userEditEpoch: number
  /** Highest revision handled per question, so a stale call is refused. */
  revisions: Map<string, number>
  /**
   * Highest revision already written per question. Kept apart from `revisions`
   * because reading and writing are not the same claim: a read may repeat at
   * one revision, since verifying a write means reading the same question
   * again, while a write may not, because a replayed write is a second write.
   */
  writes: Map<string, number>
}

export function createRuntimeState(): RuntimeState {
  return {
    bundleId: null,
    documentGeneration: null,
    userEditEpoch: 0,
    revisions: new Map<string, number>(),
    writes: new Map<string, number>(),
  }
}

/**
 * Verbs that change the page. `add_record_group` has no idempotence check of
 * its own, so a lost response that the worker retries would add a second record
 * group unless the replay is refused here.
 */
const MUTATING_VERBS: ReadonlySet<RuntimeVerb> = new Set([
  "write_text",
  "select_option",
  "toggle",
  "attach_file",
  "add_record_group",
])

/**
 * The single entry point installed in the page. It is reached with `this` bound
 * to the control the worker resolved, and every argument arrives as data: no
 * part of a call is ever evaluated as code.
 */
export async function handleDispatch(
  this: unknown,
  actionRef: unknown,
  questionRef: unknown,
  verb: unknown,
  step: unknown,
  expect: unknown,
  version: unknown,
  state?: RuntimeState
): Promise<RuntimeReply> {
  // A runtime left in a page across an extension update is the wrong build to
  // act on, and its own version is the only evidence of that.
  if (version !== RUNTIME_VERSION)
    return { ok: false, reason: RUNTIME_EVIDENCE.versionMismatch }
  if (typeof actionRef !== "string" || typeof questionRef !== "string")
    return { ok: false, reason: RUNTIME_EVIDENCE.malformed }
  if (!isRuntimeVerb(verb))
    return { ok: false, reason: RUNTIME_EVIDENCE.unknownVerb }
  const parsedStep = readStep(step)
  if (!parsedStep) return { ok: false, reason: RUNTIME_EVIDENCE.malformed }
  const parsedExpect = readExpectation(expect)
  if (!parsedExpect) return { ok: false, reason: RUNTIME_EVIDENCE.malformed }
  if (!isElement(this)) return { ok: false, reason: RUNTIME_EVIDENCE.malformed }
  const runtime = state ?? createRuntimeState()
  const replyFrom = (reply: RuntimeReplyBody): RuntimeReply =>
    withEpoch(reply, runtime.userEditEpoch)

  // The document this runtime lives in, established by the first call. A
  // request stating another generation was planned against a different
  // document, where the control it addresses may since have been replaced.
  if (
    runtime.documentGeneration !== null &&
    runtime.documentGeneration !== parsedExpect.documentGeneration
  )
    return replyFrom({
      ok: true,
      outcome: refused(verb, RUNTIME_EVIDENCE.documentGenerationChanged),
    })
  // The user edited the page after this action was planned. The write is not
  // stale in the way a value comparison detects: the page has moved on from the
  // observation behind it, so the action is refused and the run pauses.
  if (parsedExpect.userEditEpoch < runtime.userEditEpoch)
    return replyFrom({
      ok: true,
      outcome: refused(verb, RUNTIME_EVIDENCE.userEditedPage),
    })

  const held = runtime.revisions.get(questionRef)
  if (held !== undefined && parsedExpect.questionRevision < held)
    return replyFrom({
      ok: true,
      outcome: refused(verb, RUNTIME_EVIDENCE.staleRevision),
    })
  const written = runtime.writes.get(questionRef)
  if (
    MUTATING_VERBS.has(verb) &&
    written !== undefined &&
    parsedExpect.questionRevision <= written
  )
    return replyFrom({
      ok: true,
      outcome: refused(verb, RUNTIME_EVIDENCE.staleRevision),
    })
  if (
    runtime.bundleId !== null &&
    runtime.bundleId !== parsedExpect.sourceBundleId
  )
    return replyFrom({
      ok: true,
      outcome: refused(verb, RUNTIME_EVIDENCE.bundleChanged),
    })
  runtime.bundleId = parsedExpect.sourceBundleId
  runtime.documentGeneration = parsedExpect.documentGeneration
  runtime.revisions.set(questionRef, parsedExpect.questionRevision)
  if (MUTATING_VERBS.has(verb))
    runtime.writes.set(questionRef, parsedExpect.questionRevision)
  return replyFrom(await runVerb(this, verb, parsedStep, parsedExpect))
}

/**
 * Every reply the page makes carries its own edit count, refusals included: a
 * worker that is refused has to learn the new epoch before it can plan against
 * the page the user is working in.
 */
function withEpoch(
  reply: RuntimeReplyBody,
  userEditEpoch: number
): RuntimeReply {
  if (!reply.ok) return reply
  return { ok: true, outcome: reply.outcome, userEditEpoch }
}

async function runVerb(
  target: Element,
  verb: RuntimeVerb,
  step: RuntimeStep,
  expect: RuntimeExpectation
): Promise<RuntimeReplyBody> {
  try {
    switch (step.kind) {
      case "read_control":
        return { ok: true, outcome: readControl(target) }
      case "discover_options":
        return { ok: true, outcome: discoverOptions(target) }
      case "write_text":
        return { ok: true, outcome: await writeText(target, step, expect) }
      case "select_option":
        return { ok: true, outcome: await selectOption(target, step, expect) }
      case "toggle":
        return { ok: true, outcome: await toggle(target, step, expect) }
      case "attach_file":
        return {
          ok: true,
          outcome: await attachFile(target, step, expect.settleMs),
        }
      case "add_record_group":
        return { ok: true, outcome: await addRecordGroup(target) }
      default: {
        step satisfies never
        return { ok: false, reason: RUNTIME_EVIDENCE.unknownVerb }
      }
    }
  } catch {
    // A page that throws mid-write is a failed action, never a silent one.
    return {
      ok: true,
      outcome: outcome(
        verb,
        "failed",
        [RUNTIME_EVIDENCE.pageThrew],
        emptyObserved()
      ),
    }
  }
}

function refused(
  verb: RuntimeOutcome["verb"],
  reason: RuntimeEvidenceCode
): RuntimeOutcome {
  return outcome(verb, "rejected", [reason], emptyObserved())
}

function isElement(value: unknown): value is Element {
  if (typeof value !== "object" || value === null) return false
  return (value as { nodeType?: unknown }).nodeType === 1
}
