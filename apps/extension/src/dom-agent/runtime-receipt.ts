import { ReceiptSchema, type Receipt } from "@workspace/resume-core/dom-agent"
import {
  RUNTIME_EVIDENCE,
  normalizeLabel,
  type RuntimeReply,
} from "./runtime/protocol"
import type { ObservedOptionRef } from "./runtime-request"

/**
 * A reply from the page becomes a receipt. The state is the page's own verdict,
 * never upgraded here: an unresolved write stays unresolved, and a reply that
 * does not parse is a failed action rather than an assumed success.
 */

const MAX_EVIDENCE = 10
const MAX_VALUE = 2000
const MAX_ATTACHMENT_LABEL = 300

export function receiptFromReply(input: {
  actionRef: string
  questionRef: string
  reply: RuntimeReply | null
  observedOptions: readonly ObservedOptionRef[]
  at: number
}): Receipt {
  const base = {
    actionRef: input.actionRef,
    questionRef: input.questionRef,
    at: input.at,
  }
  const empty = {
    value: null,
    checked: null,
    optionRef: null,
    attachmentLabel: null,
  }
  if (!input.reply)
    return ReceiptSchema.parse({
      ...base,
      state: "failed",
      observed: empty,
      evidence: [RUNTIME_EVIDENCE.replyUnreadable],
    })
  if (!input.reply.ok)
    return ReceiptSchema.parse({
      ...base,
      state: "failed",
      observed: empty,
      evidence: [input.reply.reason],
    })
  const { outcome } = input.reply
  const optionRef = refForLabel(
    input.observedOptions,
    outcome.observed.selectedOptionLabel
  )
  const evidence = [...outcome.evidence]
  if (
    outcome.observed.selectedOptionLabel !== null &&
    optionRef === null &&
    !evidence.includes(RUNTIME_EVIDENCE.observedOptionRefUnresolved)
  )
    // The selection is real but cannot be named against the observation, so
    // the receipt says so instead of leaving the gap silent.
    evidence.push(RUNTIME_EVIDENCE.observedOptionRefUnresolved)
  return ReceiptSchema.parse({
    ...base,
    state: outcome.state,
    observed: {
      value: clip(outcome.observed.value, MAX_VALUE),
      checked: outcome.observed.checked,
      optionRef,
      attachmentLabel: clip(
        outcome.observed.attachmentName,
        MAX_ATTACHMENT_LABEL
      ),
    },
    evidence: evidence.slice(0, MAX_EVIDENCE),
  })
}

/** One label is one option. Two options with the same label name neither. */
function refForLabel(
  options: readonly ObservedOptionRef[],
  label: string | null
): string | null {
  if (label === null) return null
  const wanted = normalizeLabel(label)
  if (wanted === "") return null
  const matches = options.filter(
    (option) => normalizeLabel(option.label) === wanted
  )
  const only = matches.length === 1 ? matches[0] : undefined
  return only ? only.ref : null
}

function clip(value: string | null, max: number): string | null {
  if (value === null) return null
  return value.length <= max ? value : value.slice(0, max)
}
