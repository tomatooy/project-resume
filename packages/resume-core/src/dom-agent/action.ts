import { z } from "zod"
import { DOM_AGENT_LIMITS } from "./limits"
import { NodeRefSchema, QuestionRefSchema, RecordRefSchema } from "./primitives"

export const ActionRefSchema = z.string().min(1).max(32)

/**
 * Checked immediately before every action. A replaced control is resolved from
 * a fresh observation, never through a stale selector or a recycled identifier,
 * and the reasoning layer cannot skip this by calling an answer confident.
 */
export const PreconditionSchema = z.strictObject({
  documentGeneration: z.string().min(1).max(64),
  questionRevision: z.number().int().nonnegative(),
  sourceBundleId: z.string().min(1).max(64),
  userEditEpoch: z.number().int().nonnegative(),
})

const base = { ref: ActionRefSchema, questionRef: QuestionRefSchema }

/**
 * The bounded action vocabulary. There is no generic click or keystroke here:
 * a generic primitive would let an action escape the checks that make these
 * safe, and navigation, agreement and submission are manual by design.
 */
export const ActionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...base,
    type: z.literal("write_text"),
    value: z.string().max(4000),
    /** What the control is expected to hold now, or null when it should be empty. */
    expectedValue: z.string().max(2000).nullable(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("select_option"),
    optionRef: NodeRefSchema,
    expectedOptionRef: NodeRefSchema.nullable(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("toggle"),
    checked: z.boolean(),
    expectedChecked: z.boolean().nullable(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("attach_file"),
    pdfIdentity: z.string().length(16),
    replaceExisting: z.boolean(),
    /** Set only by a specific reviewed user choice, never by a found conflict. */
    replacementConfirmedAt: z.number().int().nonnegative().nullable(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("add_record_group"),
    recordRef: RecordRefSchema,
  }),
])

export const ActionBatchSchema = z.strictObject({
  id: z.string().min(1).max(32),
  precondition: PreconditionSchema,
  actions: z.array(ActionSchema).min(1).max(DOM_AGENT_LIMITS.actionsPerBatch),
})

export type ActionRef = z.infer<typeof ActionRefSchema>
export type Precondition = z.infer<typeof PreconditionSchema>
export type Action = z.infer<typeof ActionSchema>
export type ActionBatch = z.infer<typeof ActionBatchSchema>

/**
 * Replacing an attachment requires a specific reviewed user choice. Finding a
 * conflict is not one, so a replacement without a confirmation is not a batch
 * that may run.
 */
export function attachmentIsAuthorized(
  action: Extract<Action, { type: "attach_file" }>
): boolean {
  return !action.replaceExisting || action.replacementConfirmedAt !== null
}

export function batchIsAuthorized(batch: ActionBatch): boolean {
  return batch.actions.every(
    (action) => action.type !== "attach_file" || attachmentIsAuthorized(action)
  )
}

/** Actions that can run together, because none of them changes a dependency. */
export function independentActions(batch: ActionBatch): Action[] {
  return batch.actions.filter((action) => action.type !== "add_record_group")
}
