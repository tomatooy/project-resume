import {
  applyFiles,
  attachmentStateNear,
  buildFile,
  controlledChildCount,
  currentFiles,
  dispatchInputEvents,
  isDisabled,
  isReadOnly,
  looksLikeSubmit,
  nativeSet,
  normalizeLabel,
  optionEntries,
  readChecked,
  readValue,
  settle,
  type OptionEntry,
} from "./control"
import {
  RUNTIME_EVIDENCE,
  emptyObserved,
  type RuntimeEvidenceCode,
  type RuntimeExpectation,
  type RuntimeObserved,
  type RuntimeOutcome,
  type RuntimeStep,
  type RuntimeVerb,
} from "./protocol"

type Step<K extends RuntimeStep["kind"]> = Extract<RuntimeStep, { kind: K }>

export function outcome(
  verb: RuntimeVerb,
  state: RuntimeOutcome["state"],
  evidence: RuntimeEvidenceCode[],
  observed: RuntimeObserved = emptyObserved(),
  options: RuntimeOutcome["options"] = []
): RuntimeOutcome {
  return { state, verb, observed, evidence, options }
}

function refused(
  verb: RuntimeVerb,
  code: RuntimeEvidenceCode,
  observed: RuntimeObserved = emptyObserved(),
  options: RuntimeOutcome["options"] = []
): RuntimeOutcome {
  return outcome(verb, "rejected", [code], observed, options)
}

/**
 * Liveness and interactivity, checked immediately before a write. A control
 * that left the document, or that the page disabled, is never written to: the
 * worker resolved it from the current observation, but resolution and writing
 * are not the same instant.
 */
function blocked(control: Element, verb: RuntimeVerb): RuntimeOutcome | null {
  if (!control.isConnected) return refused(verb, RUNTIME_EVIDENCE.notConnected)
  if (isDisabled(control)) return refused(verb, RUNTIME_EVIDENCE.disabled)
  return null
}

/** The page's own view of the options a control offers, in DOM order. */
function snapshotOptions(entries: OptionEntry[]): RuntimeOutcome["options"] {
  return entries.map((entry) => ({
    label: entry.label,
    value: entry.value,
    selected: entry.selected,
    disabled: entry.disabled,
  }))
}

export function readControl(control: Element): RuntimeOutcome {
  const block = blocked(control, "read_control")
  if (block) return block
  const selected = optionEntries(control).find((entry) => entry.selected)
  return outcome("read_control", "accepted", [RUNTIME_EVIDENCE.readSucceeded], {
    ...emptyObserved(),
    value: readValue(control),
    checked: readChecked(control),
    selectedOptionLabel: selected?.label ?? null,
    groupChildCount: controlledChildCount(control),
  })
}

export function discoverOptions(control: Element): RuntimeOutcome {
  const block = blocked(control, "discover_options")
  if (block) return block
  const entries = optionEntries(control)
  const options = snapshotOptions(entries)
  if (entries.length === 0)
    return outcome(
      "discover_options",
      "unresolved",
      [RUNTIME_EVIDENCE.optionNotFound],
      emptyObserved(),
      options
    )
  const selected = entries.find((entry) => entry.selected)
  return outcome(
    "discover_options",
    "accepted",
    [RUNTIME_EVIDENCE.readSucceeded],
    { ...emptyObserved(), selectedOptionLabel: selected?.label ?? null },
    options
  )
}

/**
 * Text entry. The previous value is the control's own, read here rather than
 * trusted from the action, because a page value the user set is not the
 * worker's to assume.
 */
export async function writeText(
  control: Element,
  step: Step<"write_text">,
  expect: RuntimeExpectation
): Promise<RuntimeOutcome> {
  const block = blocked(control, "write_text")
  if (block) return block
  if (isReadOnly(control))
    return refused("write_text", RUNTIME_EVIDENCE.readOnly)
  const before = readValue(control) ?? ""
  // The action always states what the control holds now: a string, or empty.
  // A control that moved since the observation is a different question now.
  if (before !== (expect.expectedValue ?? ""))
    return refused("write_text", RUNTIME_EVIDENCE.expectedValueMismatch, {
      ...emptyObserved(),
      value: before,
    })
  if (!nativeSet(control, "value", step.value))
    return refused("write_text", RUNTIME_EVIDENCE.unsupportedControl)
  dispatchInputEvents(control, ["input", "change"])
  const settled = await settle(
    () => readValue(control) ?? "",
    (value) => value === step.value,
    expect.settleMs
  )
  const observed = { ...emptyObserved(), value: settled }
  if (settled === step.value)
    return outcome(
      "write_text",
      "accepted",
      [RUNTIME_EVIDENCE.valueSet],
      observed
    )
  // Back at the value it held before the write is the framework refusing the
  // edit, which is a rejection rather than something still in flight.
  if (settled === before)
    return refused("write_text", RUNTIME_EVIDENCE.valueReverted, observed)
  return outcome(
    "write_text",
    "unresolved",
    [RUNTIME_EVIDENCE.valueNotSettled],
    observed
  )
}

function matchOption(
  entries: OptionEntry[],
  label: string
): { entry: OptionEntry } | { problem: RuntimeEvidenceCode } {
  const wanted = normalizeLabel(label)
  const matches = entries.filter(
    (entry) => normalizeLabel(entry.label) === wanted
  )
  const only = matches.length === 1 ? matches[0] : undefined
  if (!only)
    return {
      problem:
        matches.length > 1
          ? RUNTIME_EVIDENCE.optionAmbiguous
          : RUNTIME_EVIDENCE.optionNotFound,
    }
  return { entry: only }
}

/** Choosing an option the page currently shows, matched by its own label. */
export async function selectOption(
  control: Element,
  step: Step<"select_option">,
  expect: RuntimeExpectation
): Promise<RuntimeOutcome> {
  const block = blocked(control, "select_option")
  if (block) return block
  const entries = optionEntries(control)
  const options = snapshotOptions(entries)
  const current = entries.find((entry) => entry.selected)
  if (
    expect.expectedOptionLabel !== null &&
    normalizeLabel(current?.label ?? "") !==
      normalizeLabel(expect.expectedOptionLabel)
  )
    return refused(
      "select_option",
      RUNTIME_EVIDENCE.expectedOptionMismatch,
      { ...emptyObserved(), selectedOptionLabel: current?.label ?? null },
      options
    )
  const matched = matchOption(entries, step.optionLabel)
  if ("problem" in matched) {
    // An option the observation does not hold cannot be chosen by label: the
    // page may have re-rendered since, and guessing would select the wrong one.
    return refused(
      "select_option",
      matched.problem,
      { ...emptyObserved(), selectedOptionLabel: current?.label ?? null },
      options
    )
  }
  const target = matched.entry
  if (target.selected)
    return outcome(
      "select_option",
      "accepted",
      [RUNTIME_EVIDENCE.optionSelected],
      { ...emptyObserved(), selectedOptionLabel: target.label },
      options
    )
  if (target.disabled)
    return refused(
      "select_option",
      RUNTIME_EVIDENCE.disabled,
      undefined,
      options
    )
  if (!applySelection(control, target, entries))
    return refused(
      "select_option",
      RUNTIME_EVIDENCE.unsupportedControl,
      undefined,
      options
    )
  const settled = await settle(
    // Read the target itself. Reading "the first selected entry" compared the
    // wrong element whenever the user's own earlier choice came first in
    // document order, which reported a filled control as unresolved.
    () =>
      optionEntries(control).find(
        (entry) => normalizeLabel(entry.label) === normalizeLabel(target.label)
      ) ?? null,
    (entry) => entry?.selected === true,
    expect.settleMs
  )
  const observed = {
    ...emptyObserved(),
    value: readValue(control),
    selectedOptionLabel: settled?.selected === true ? settled.label : null,
  }
  // Acceptance is the target entry's own selected state. Comparing labels would
  // accept a page that changed nothing, because the entry is found by label
  // whether or not it is selected, and settle returns its last read on timeout.
  if (settled?.selected === true)
    return outcome(
      "select_option",
      "accepted",
      [RUNTIME_EVIDENCE.optionSelected],
      observed,
      options
    )
  return outcome(
    "select_option",
    "unresolved",
    [RUNTIME_EVIDENCE.optionNotSelected],
    observed,
    options
  )
}

/** A select takes a value; a grouped choice takes an activation on the option. */
function applySelection(
  control: Element,
  target: OptionEntry,
  entries: OptionEntry[]
): boolean {
  if (control.tagName.toLowerCase() === "select") {
    const value = target.value ?? target.label
    if (nativeSet(control, "value", value)) {
      dispatchInputEvents(control, ["input", "change"])
      return true
    }
    return false
  }
  const clickable = entries.includes(target)
  if (!clickable) return false
  dispatchInputEvents(target.element, ["click", "input", "change"])
  return true
}

/**
 * A single checkbox or switch. A toggle must state the state it expects: with
 * no expectation there is nothing to check the write against, so a change the
 * user made after the observation would be overwritten by a write that cannot
 * tell. A toggle that states nothing therefore writes nothing.
 */
export async function toggle(
  control: Element,
  step: Step<"toggle">,
  expect: RuntimeExpectation
): Promise<RuntimeOutcome> {
  const block = blocked(control, "toggle")
  if (block) return block
  // An empty selection is not a state to compare against: a toggle that states
  // nothing would overwrite a change the user made after the observation.
  if (expect.expectedChecked === null)
    return refused("toggle", RUNTIME_EVIDENCE.expectedCheckedMissing)
  const before = readChecked(control)
  if (before === null)
    return refused("toggle", RUNTIME_EVIDENCE.unsupportedControl)
  if (before !== expect.expectedChecked)
    return refused("toggle", RUNTIME_EVIDENCE.expectedCheckedMismatch, {
      ...emptyObserved(),
      checked: before,
    })
  if (before === step.checked)
    return outcome("toggle", "accepted", [RUNTIME_EVIDENCE.checkedSet], {
      ...emptyObserved(),
      checked: before,
    })
  const tag = control.tagName.toLowerCase()
  let activated = false
  if (tag === "input" || tag === "button") {
    dispatchInputEvents(control, ["click"])
    activated = true
  } else if (nativeSet(control, "checked", step.checked)) {
    dispatchInputEvents(control, ["input", "change"])
    activated = true
  }
  if (!activated) return refused("toggle", RUNTIME_EVIDENCE.unsupportedControl)
  const settled = await settle(
    () => readChecked(control),
    (value) => value === step.checked,
    expect.settleMs
  )
  const observed = { ...emptyObserved(), checked: settled }
  if (settled === step.checked)
    return outcome(
      "toggle",
      "accepted",
      [RUNTIME_EVIDENCE.checkedSet],
      observed
    )
  if (settled === before)
    return refused("toggle", RUNTIME_EVIDENCE.checkedReverted, observed)
  return outcome(
    "toggle",
    "unresolved",
    [RUNTIME_EVIDENCE.checkedNotSettled],
    observed
  )
}

/**
 * The local handoff for an attachment: bytes become a FileList on the input.
 * Whether the site took the upload is a different question, which is why this
 * reports accepted only when the site shows a state of its own. A site that
 * shows nothing leaves the outcome unverified.
 */
export async function attachFile(
  control: Element,
  step: Step<"attach_file">,
  settleMs: number
): Promise<RuntimeOutcome> {
  const block = blocked(control, "attach_file")
  if (block) return block
  if ((control as HTMLInputElement).type !== "file")
    return refused("attach_file", RUNTIME_EVIDENCE.unsupportedControl)
  const existing = currentFiles(control)
  const observed = {
    ...emptyObserved(),
    attachmentName: existing[0]?.name ?? null,
  }
  if (existing.length > 0 && !step.replaceExisting)
    return refused(
      "attach_file",
      RUNTIME_EVIDENCE.existingAttachmentPreserved,
      observed
    )
  // Belt and braces: the worker already declines to express an unauthorized
  // replacement, and the page still refuses one it cannot justify, so a
  // malformed request cannot overwrite an attachment the user placed.
  if (existing.length > 0 && !step.replacementConfirmed)
    return refused(
      "attach_file",
      RUNTIME_EVIDENCE.replacementUnconfirmed,
      observed
    )
  const file = buildFile(control, step.file)
  if (!file)
    return refused("attach_file", RUNTIME_EVIDENCE.fileMalformed, observed)
  if (!applyFiles(control, [file]))
    return outcome(
      "attach_file",
      "failed",
      [RUNTIME_EVIDENCE.fileAssignmentFailed],
      observed
    )
  dispatchInputEvents(control, ["input", "change"])
  const applied = currentFiles(control).find(
    (candidate) => candidate.name === file.name && candidate.size === file.size
  )
  if (!applied)
    return outcome(
      "attach_file",
      "failed",
      [RUNTIME_EVIDENCE.fileAssignmentFailed],
      observed
    )
  // The site's own state settles this, and the file list never does. A site
  // that renders a chip naming the file has taken it; one that marks an error
  // has refused it; one that shows neither leaves it unverified.
  const settled = await settle(
    () => attachmentStateNear(control, applied.name),
    (state) => state !== null,
    settleMs
  )
  const attachment = { ...emptyObserved(), attachmentName: applied.name }
  if (settled === "rejected")
    return outcome(
      "attach_file",
      "rejected",
      [
        RUNTIME_EVIDENCE.fileListAssigned,
        RUNTIME_EVIDENCE.attachmentStateRejected,
      ],
      attachment
    )
  if (settled === "accepted")
    return outcome(
      "attach_file",
      "accepted",
      [
        RUNTIME_EVIDENCE.fileListAssigned,
        RUNTIME_EVIDENCE.attachmentStateAccepted,
      ],
      attachment
    )
  return outcome(
    "attach_file",
    "unresolved",
    [
      RUNTIME_EVIDENCE.fileListAssigned,
      RUNTIME_EVIDENCE.uploadStateNotObservable,
    ],
    attachment
  )
}

/**
 * Record creation, through the control the page provides for it. A control that
 * would submit the form is refused before it is activated, and growth is only
 * claimed when the page names the container it grows.
 */
export async function addRecordGroup(
  control: Element
): Promise<RuntimeOutcome> {
  const block = blocked(control, "add_record_group")
  if (block) return block
  if (looksLikeSubmit(control))
    return refused("add_record_group", RUNTIME_EVIDENCE.submitAffordanceRefused)
  const before = controlledChildCount(control)
  dispatchInputEvents(control, ["click"])
  if (before === null)
    return outcome(
      "add_record_group",
      "unresolved",
      [RUNTIME_EVIDENCE.groupGrowthNotObservable],
      { ...emptyObserved(), groupChildCount: null }
    )
  const after = await settle(
    () => controlledChildCount(control),
    (count) => count !== null && count > before,
    2_000
  )
  if (after !== null && after > before)
    return outcome(
      "add_record_group",
      "accepted",
      [RUNTIME_EVIDENCE.groupChildCountIncreased],
      { ...emptyObserved(), groupChildCount: after }
    )
  return outcome(
    "add_record_group",
    "unresolved",
    [RUNTIME_EVIDENCE.groupGrowthNotObservable],
    { ...emptyObserved(), groupChildCount: after }
  )
}
