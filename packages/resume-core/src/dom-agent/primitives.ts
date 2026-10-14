import { z } from "zod"

/**
 * Identity within one observation. A browser node reference is valid only for
 * the document generation that produced it and is never persisted, never sent
 * to a model as durable identity, and never used as a saved-answer key.
 */
export const NodeRefSchema = z.string().min(1).max(64)

/** Identity of a question within one page run. Stable until the evidence changes. */
export const QuestionRefSchema = z.string().min(1).max(32)

/** Identity of one record inside a repeated group, within the page. */
export const RecordRefSchema = z.string().min(1).max(64)

/**
 * A condition an answer's meaning depends on. Structured rather than free
 * text, because two answers with different scope are different answers.
 */
export const ScopeDimensionSchema = z.enum([
  "country",
  "employer",
  "role",
  "time",
  "currency",
  "period",
  "record",
  "other",
])
export const ScopeEntrySchema = z.strictObject({
  dimension: ScopeDimensionSchema,
  value: z.string().min(1).max(200),
})

/** An option as the page presents it, with the reference needed to choose it. */
export const ObservedOptionSchema = z.strictObject({
  ref: NodeRefSchema,
  label: z.string().max(500),
  value: z.string().max(500).nullable(),
  selected: z.boolean(),
  disabled: z.boolean(),
})

/**
 * Requiredness with the evidence that established it. An absent attribute
 * alone never establishes optionality, so `unknown` is a first-class answer.
 */
export const RequirednessEvidenceSchema = z.enum([
  "native_attribute",
  "aria_attribute",
  "visible_marker",
  "instruction_text",
  "group_requirement",
])
export const RequirednessSchema = z.strictObject({
  state: z.enum(["required", "optional", "unknown"]),
  evidence: z.array(RequirednessEvidenceSchema).max(5),
})

/** What the control is, natively. Not what the page is asking. */
export const ControlKindSchema = z.enum([
  "text",
  "long_text",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "month",
  "select",
  "combobox",
  "radio_group",
  "checkbox_group",
  "checkbox",
  "button_choice",
  "file",
  "unknown",
])

/** What the page is asking. Derived from meaning, not from the control kind. */
export const QuestionKindSchema = z.enum([
  "short_text",
  "long_text",
  "single_choice",
  "multi_choice",
  "yes_no",
  "date",
  "month",
  "number",
  "money",
  "url",
  "file",
  "record_group",
  "unknown",
])

export type ScopeDimension = z.infer<typeof ScopeDimensionSchema>
export type ScopeEntry = z.infer<typeof ScopeEntrySchema>
export type ObservedOption = z.infer<typeof ObservedOptionSchema>
export type Requiredness = z.infer<typeof RequirednessSchema>
export type ControlKind = z.infer<typeof ControlKindSchema>
export type QuestionKind = z.infer<typeof QuestionKindSchema>
