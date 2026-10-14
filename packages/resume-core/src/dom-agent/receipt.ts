import { z } from "zod"
import { ActionRefSchema } from "./action"
import { QuestionRefSchema } from "./primitives"

/**
 * Dispatch, accepted control state, and unresolved verification are three
 * different things. A successful click or input command is not a receipt.
 */
export const ReceiptStateSchema = z.enum([
  "dispatched",
  "accepted",
  "unresolved",
  "failed",
  "rejected",
])

export const ReceiptSchema = z.strictObject({
  actionRef: ActionRefSchema,
  questionRef: QuestionRefSchema,
  state: ReceiptStateSchema,
  /** Live properties and observed widget state, not serialized markup. */
  observed: z.strictObject({
    value: z.string().max(2000).nullable(),
    checked: z.boolean().nullable(),
    optionRef: z.string().max(64).nullable(),
    attachmentLabel: z.string().max(300).nullable(),
  }),
  evidence: z.array(z.string().max(200)).max(10),
  at: z.number().int().nonnegative(),
})

export type ReceiptState = z.infer<typeof ReceiptStateSchema>
export type Receipt = z.infer<typeof ReceiptSchema>

/** A receipt that needs no further work. Everything else is still open. */
export function receiptSettles(receipt: Receipt): boolean {
  return receipt.state === "accepted"
}

/**
 * Counts for progress display. Deliberately not a readiness input: the number
 * of writes completed must never stand in for the audit's decision.
 */
export function verifiedProgress(receipts: readonly Receipt[]): {
  accepted: number
  unresolved: number
  failed: number
} {
  let accepted = 0
  let unresolved = 0
  let failed = 0
  for (const receipt of receipts) {
    if (receipt.state === "accepted") accepted += 1
    else if (receipt.state === "failed" || receipt.state === "rejected")
      failed += 1
    else unresolved += 1
  }
  return { accepted, unresolved, failed }
}

/**
 * Late rejection and framework reversion: a receipt that was accepted and is
 * no longer true. Detected against a fresh observation, not against the state
 * that produced the receipt.
 */
export function revertedReceipts(
  receipts: readonly Receipt[],
  observedByQuestion: Record<
    string,
    | {
        value?: string | null
        checked?: boolean | null
        optionRef?: string | null
      }
    | undefined
  >
): Receipt[] {
  const reverted: Receipt[] = []
  for (const receipt of receipts) {
    if (receipt.state !== "accepted") continue
    const observed = observedByQuestion[receipt.questionRef]
    if (!observed) continue
    // A selection is named by its option, not by the control's value: a radio
    // anchor's own value attribute never changes, so comparing values alone
    // would never notice the page moving the selection back.
    if (
      receipt.observed.optionRef !== null &&
      observed.optionRef !== undefined &&
      observed.optionRef !== receipt.observed.optionRef
    )
      reverted.push(receipt)
    else if (
      receipt.observed.value !== null &&
      observed.value !== undefined &&
      observed.value !== receipt.observed.value
    )
      reverted.push(receipt)
    else if (
      receipt.observed.checked !== null &&
      observed.checked !== undefined &&
      observed.checked !== receipt.observed.checked
    )
      reverted.push(receipt)
  }
  return reverted
}
