import {
  RUNTIME_EVIDENCE,
  RUNTIME_VERSION,
  emptyObserved,
  isRuntimeVerb,
  readExpectation,
  readStep,
  type RuntimeEvidenceCode,
  type RuntimeOutcome,
  type RuntimeReply,
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

  const held = runtime.revisions.get(questionRef)
  if (held !== undefined && parsedExpect.questionRevision < held)
    return {
      ok: true,
      outcome: refused(verb, RUNTIME_EVIDENCE.staleRevision),
    }
  const written = runtime.writes.get(questionRef)
  if (
    MUTATING_VERBS.has(verb) &&
    written !== undefined &&
    parsedExpect.questionRevision <= written
  )
    return {
      ok: true,
      outcome: refused(verb, RUNTIME_EVIDENCE.staleRevision),
    }
  if (
    runtime.bundleId !== null &&
    runtime.bundleId !== parsedExpect.sourceBundleId
  )
    return {
      ok: true,
      outcome: refused(verb, RUNTIME_EVIDENCE.bundleChanged),
    }
  runtime.bundleId = parsedExpect.sourceBundleId
  runtime.revisions.set(questionRef, parsedExpect.questionRevision)
  if (MUTATING_VERBS.has(verb))
    runtime.writes.set(questionRef, parsedExpect.questionRevision)
  try {
    switch (parsedStep.kind) {
      case "read_control":
        return { ok: true, outcome: readControl(this) }
      case "discover_options":
        return { ok: true, outcome: discoverOptions(this) }
      case "write_text":
        return {
          ok: true,
          outcome: await writeText(this, parsedStep, parsedExpect),
        }
      case "select_option":
        return {
          ok: true,
          outcome: await selectOption(this, parsedStep, parsedExpect),
        }
      case "toggle":
        return {
          ok: true,
          outcome: await toggle(this, parsedStep, parsedExpect),
        }
      case "attach_file":
        return { ok: true, outcome: attachFile(this, parsedStep) }
      case "add_record_group":
        return { ok: true, outcome: await addRecordGroup(this) }
      default: {
        parsedStep satisfies never
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

export function refused(
  verb: RuntimeOutcome["verb"],
  reason: RuntimeEvidenceCode
): RuntimeOutcome {
  return outcome(verb, "rejected", [reason], emptyObserved())
}

function isElement(value: unknown): value is Element {
  if (typeof value !== "object" || value === null) return false
  return (value as { nodeType?: unknown }).nodeType === 1
}
