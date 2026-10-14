import type { ReceiptState } from "@workspace/resume-core/dom-agent"

/**
 * The page-side wire format, shared by the bundled runtime and the service
 * worker that builds these calls. Only types cross from resume-core into this
 * file, because the runtime bundle must inline no schema library and must not
 * reach any extension API.
 */
export const RUNTIME_VERSION = 1

export const RUNTIME_BUNDLE_FILE = "dom-agent-runtime.js"

/** The global vite assigns the IIFE bundle to; the install expression reads it. */
export const RUNTIME_LIB_NAME = "VsDomAgent"

/** Installed globals are keyed by a per-install nonce, not by a fixed name. */
export const RUNTIME_GLOBAL_PREFIX = "__vsDomAgent"

/**
 * Hard ceiling for one control interaction, mirroring
 * DOM_AGENT_LIMITS.controlInteractionMs. The worker passes its own settle
 * budget and this clamps it, so the page can never be asked to wait longer
 * than the contract allows even if the request lies about it.
 */
export const RUNTIME_SETTLE_MAX_MS = 8_000

/** Poll interval while waiting for a control to settle. */
export const RUNTIME_SETTLE_POLL_MS = 20

/**
 * The verbs the page accepts. A verb is looked up in a frozen map by name;
 * nothing in this list can be replaced by text from a request.
 */
export const RUNTIME_VERBS = [
  "read_control",
  "discover_options",
  "write_text",
  "select_option",
  "toggle",
  "attach_file",
  "add_record_group",
] as const

export type RuntimeVerb = (typeof RUNTIME_VERBS)[number]

const VERB_SET = new Set<string>(RUNTIME_VERBS)

export function isRuntimeVerb(value: unknown): value is RuntimeVerb {
  return typeof value === "string" && VERB_SET.has(value)
}

/**
 * What to do, mirroring the action union in resume-core minus every browser
 * identity. Node references never reach the page: the worker resolves them to
 * a live control and passes that as the call target.
 */
export type RuntimeStep =
  | { kind: "read_control" }
  | { kind: "discover_options" }
  | { kind: "write_text"; value: string }
  | { kind: "select_option"; optionLabel: string }
  | { kind: "toggle"; checked: boolean }
  | {
      kind: "attach_file"
      file: { name: string; type: string; sizeBytes: number; base64: string }
      replaceExisting: boolean
      /**
       * Set from a reviewed authorization only. The page refuses a replacement
       * it cannot justify on its own, so a request claiming one is not enough.
       */
      replacementConfirmed: boolean
    }
  | { kind: "add_record_group" }

/**
 * The preconditions an action must still satisfy at the moment it writes.
 * Document/frame generation is enforced by the addressing itself: the worker
 * resolves the control from the current observation, and a control from a dead
 * generation no longer resolves. The parts a page can check on its own are
 * checked here, before the write.
 */
export type RuntimeExpectation = {
  documentGeneration: string
  questionRevision: number
  sourceBundleId: string
  userEditEpoch: number
  /** Clamped against RUNTIME_SETTLE_MAX_MS. */
  settleMs: number
  expectedValue: string | null
  expectedChecked: boolean | null
  expectedOptionLabel: string | null
}

/** Every reason a receipt can carry. Fixed codes, never page text. */
export const RUNTIME_EVIDENCE = {
  notConnected: "control_not_connected",
  disabled: "control_disabled",
  readOnly: "control_read_only",
  malformed: "malformed_request",
  unknownVerb: "unknown_verb",
  staleRevision: "stale_question_revision",
  bundleChanged: "source_bundle_changed",
  versionMismatch: "runtime_version_mismatch",
  expectedValueMismatch: "expected_value_mismatch",
  expectedCheckedMismatch: "expected_checked_mismatch",
  expectedCheckedMissing: "expected_checked_missing",
  expectedOptionMismatch: "expected_option_mismatch",
  unsupportedControl: "unsupported_control",
  valueSet: "value_set",
  valueReverted: "value_reverted_after_write",
  valueNotSettled: "value_not_settled",
  checkedSet: "checked_set",
  checkedReverted: "checked_reverted_after_write",
  checkedNotSettled: "checked_not_settled",
  optionNotFound: "option_not_found",
  optionAmbiguous: "option_ambiguous",
  optionSelected: "option_selected",
  optionNotSelected: "option_not_selected",
  existingAttachmentPreserved: "existing_attachment_preserved",
  replacementUnconfirmed: "attachment_replacement_unconfirmed",
  fileListAssigned: "file_list_assigned",
  fileMalformed: "attachment_bytes_rejected",
  fileAssignmentFailed: "file_assignment_failed",
  uploadStateNotObservable: "upload_state_not_observable",
  submitAffordanceRefused: "submit_affordance_refused",
  groupChildCountIncreased: "group_child_count_increased",
  groupGrowthNotObservable: "group_growth_not_observable",
  observedOptionRefUnresolved: "observed_option_ref_unresolved",
  replyUnreadable: "reply_not_readable",
  pageThrew: "page_threw",
  readSucceeded: "read_succeeded",
} as const

export type RuntimeEvidenceCode =
  (typeof RUNTIME_EVIDENCE)[keyof typeof RUNTIME_EVIDENCE]

/**
 * How labels are compared, shared because both sides match on them: the page
 * against the options it sees, the worker against the observation it holds. Two
 * normalizations would mean an option matched on one side and not the other.
 */
export function normalizeLabel(text: string | null | undefined): string {
  if (!text) return ""
  return text.replace(/\s+/g, " ").trim()
}

/** Live widget state, as the page sees it. Not serialized markup. */
export type RuntimeObserved = {
  value: string | null
  checked: boolean | null
  selectedOptionLabel: string | null
  attachmentName: string | null
  groupChildCount: number | null
}

export type RuntimeOutcome = {
  state: ReceiptState
  verb: RuntimeVerb
  observed: RuntimeObserved
  evidence: RuntimeEvidenceCode[]
  /** Label and value of every option the page currently shows, in DOM order. */
  options: {
    label: string
    value: string | null
    selected: boolean
    disabled: boolean
  }[]
}

/** What the install expression returns, so the worker can address this runtime. */
export type RuntimeInstall = {
  version: number
  nonce: string
  key: string
}

/**
 * A call either reached a verb or did not. A malformed call is not a verb
 * outcome: reporting one would put a verb name on a receipt that never ran.
 */
export type RuntimeReply =
  | { ok: true; outcome: RuntimeOutcome }
  | { ok: false; reason: RuntimeEvidenceCode }

export function emptyObserved(): RuntimeObserved {
  return {
    value: null,
    checked: null,
    selectedOptionLabel: null,
    attachmentName: null,
    groupChildCount: null,
  }
}

/**
 * Structural validation of a call that crossed a process boundary. The worker
 * validates the action against its schema first; this only establishes that the
 * page is being handed the shape it will use, and never evaluates anything.
 */
export function readStep(value: unknown): RuntimeStep | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  if (!isRuntimeVerb(kind)) return null
  switch (kind) {
    case "read_control":
    case "discover_options":
    case "add_record_group":
      return { kind }
    case "write_text":
      return typeof value.value === "string"
        ? { kind, value: value.value }
        : null
    case "select_option":
      return typeof value.optionLabel === "string"
        ? { kind, optionLabel: value.optionLabel }
        : null
    case "toggle":
      return typeof value.checked === "boolean"
        ? { kind, checked: value.checked }
        : null
    case "attach_file": {
      const file = value.file
      if (!isRecord(file)) return null
      if (typeof file.name !== "string" || typeof file.base64 !== "string")
        return null
      if (typeof file.type !== "string" || typeof file.sizeBytes !== "number")
        return null
      return {
        kind,
        file: {
          name: file.name,
          type: file.type,
          sizeBytes: file.sizeBytes,
          base64: file.base64,
        },
        replaceExisting: value.replaceExisting === true,
        replacementConfirmed: value.replacementConfirmed === true,
      }
    }
    default:
      return null
  }
}

export function readExpectation(value: unknown): RuntimeExpectation | null {
  if (!isRecord(value)) return null
  const {
    documentGeneration,
    questionRevision,
    sourceBundleId,
    userEditEpoch,
    settleMs,
    expectedValue,
    expectedChecked,
    expectedOptionLabel,
  } = value
  if (typeof documentGeneration !== "string") return null
  if (typeof sourceBundleId !== "string") return null
  if (!isCount(questionRevision) || !isCount(userEditEpoch)) return null
  if (!isCount(settleMs)) return null
  if (!isNullableString(expectedValue)) return null
  if (!isNullableString(expectedOptionLabel)) return null
  if (expectedChecked !== null && typeof expectedChecked !== "boolean")
    return null
  return {
    documentGeneration,
    questionRevision,
    sourceBundleId,
    userEditEpoch,
    settleMs: Math.min(settleMs, RUNTIME_SETTLE_MAX_MS),
    expectedValue,
    expectedChecked,
    expectedOptionLabel,
  }
}

const REPLY_STATES = new Set<string>([
  "dispatched",
  "accepted",
  "unresolved",
  "failed",
  "rejected",
])

const EVIDENCE_CODES = new Set<string>(Object.values(RUNTIME_EVIDENCE))

/**
 * The worker validates what came back rather than trusting it: a page can be
 * anything, and a reply that does not parse must become a failed action, never
 * an accepted one.
 */
export function readReply(value: unknown): RuntimeReply | null {
  if (!isRecord(value)) return null
  if (value.ok === false) {
    const reason = value.reason
    return isEvidenceCode(reason) ? { ok: false, reason } : null
  }
  if (value.ok !== true) return null
  const outcome = value.outcome
  if (!isRecord(outcome)) return null
  const state = outcome.state
  if (!isReceiptState(state)) return null
  if (!isRuntimeVerb(outcome.verb)) return null
  const evidence = outcome.evidence
  if (!Array.isArray(evidence)) return null
  if (!evidence.every(isEvidenceCode)) return null
  const observed = readObserved(outcome.observed)
  if (!observed) return null
  const options = readOptions(outcome.options)
  if (!options) return null
  return {
    ok: true,
    outcome: {
      state,
      verb: outcome.verb,
      observed,
      evidence,
      options,
    },
  }
}

function isEvidenceCode(value: unknown): value is RuntimeEvidenceCode {
  return typeof value === "string" && EVIDENCE_CODES.has(value)
}

function isReceiptState(value: unknown): value is RuntimeOutcome["state"] {
  return typeof value === "string" && REPLY_STATES.has(value)
}

function readObserved(value: unknown): RuntimeObserved | null {
  if (!isRecord(value)) return null
  const {
    value: text,
    checked,
    selectedOptionLabel,
    attachmentName,
    groupChildCount,
  } = value
  if (!isNullableString(text)) return null
  if (checked !== null && typeof checked !== "boolean") return null
  if (!isNullableString(selectedOptionLabel)) return null
  if (!isNullableString(attachmentName)) return null
  if (groupChildCount !== null && !isCount(groupChildCount)) return null
  return {
    value: text,
    checked,
    selectedOptionLabel,
    attachmentName,
    groupChildCount,
  }
}

function readOptions(value: unknown): RuntimeOutcome["options"] | null {
  if (!Array.isArray(value)) return null
  const options: RuntimeOutcome["options"] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const { label, value: optionValue, selected, disabled } = entry
    if (typeof label !== "string") return null
    if (!isNullableString(optionValue)) return null
    if (typeof selected !== "boolean" || typeof disabled !== "boolean")
      return null
    options.push({ label, value: optionValue, selected, disabled })
  }
  return options
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}
