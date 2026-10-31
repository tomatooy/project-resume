import { EducationItemSchema } from "@workspace/resume-schema"
import { z } from "zod"

import { CanonicalKeySchema, ProfileSectionSchema } from "./keys"

export * from "./keys"

/** Request limits shared by the extension, which trims, and the server, which checks. */
export const LIMITS = {
  fields: 200,
  label: 500,
  help: 2000,
  options: 300,
  option: 200,
  answer: 4000,
  instruction: 500,
} as const

const FieldIdSchema = z.string().min(1).max(300)

export const ControlSchema = z.enum([
  "text",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "month",
  "textarea",
  "select",
  "combobox",
  "radio",
  "checkbox",
  "checkboxes",
  "file",
])
export type Control = z.infer<typeof ControlSchema>

/**
 * Option ids are positional: `#1`, `#2`, ... in page order after
 * placeholders are dropped.
 */
export const OptionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(LIMITS.option),
  description: z.string().max(LIMITS.option).optional(),
})
export type Option = z.infer<typeof OptionSchema>

const educationFields = EducationItemSchema.pick({
  school: true,
  degree: true,
  field: true,
  start: true,
  end: true,
}).keyof()

/** The record and component a repeated control edits. */
export const RecordFieldSchema = z.object({
  kind: z.literal("education"),
  index: z
    .number()
    .int()
    .min(0)
    .max(LIMITS.fields - 1),
  field: z.enum([...educationFields.options, "current"]),
  part: z.enum(["month", "year"]).optional(),
})
export type RecordField = z.infer<typeof RecordFieldSchema>

export const FieldDescriptorSchema = z.object({
  /** Stable for the posting: vendor key, else name or id, else a structural path. */
  id: FieldIdSchema,
  label: z.string().max(LIMITS.label),
  help: z.string().max(LIMITS.help).optional(),
  section: z.string().max(LIMITS.label).optional(),
  record: RecordFieldSchema.optional(),
  control: ControlSchema,
  options: z.array(OptionSchema).max(LIMITS.options).optional(),
  optionState: z.enum(["pending", "ready", "search", "unavailable"]).optional(),
  /** The options exist only while the widget is open; read on Autofill. */
  optionsPending: z.boolean().optional(),
  searchable: z.boolean().optional(),
  multiple: z.boolean().optional(),
  required: z.boolean(),
  maxLength: z.number().int().positive().optional(),
  hasValue: z.boolean(),
  autocomplete: z.string().max(100).optional(),
})
export type FieldDescriptor = z.infer<typeof FieldDescriptorSchema>

export const FieldsSchema = z
  .array(FieldDescriptorSchema)
  .max(LIMITS.fields)
  .refine((fields) => new Set(fields.map((f) => f.id)).size === fields.length, {
    message: "Field ids must be unique",
  })

const FillBaseSchema = z.object({
  fieldId: FieldIdSchema,
  source: z.enum(["rule", "ai"]),
})

export const LocationTargetSchema = z.object({
  city: z.string().trim().min(1).max(200),
  region: z.string().trim().min(1).max(200).optional(),
  country: z.string().trim().min(1).max(200).optional(),
})
export type LocationTarget = z.infer<typeof LocationTargetSchema>

export const FillSchema = z
  .discriminatedUnion("kind", [
    FillBaseSchema.extend({
      kind: z.literal("text"),
      value: z.string().min(1).max(LIMITS.answer),
    }),
    FillBaseSchema.extend({
      kind: z.literal("options"),
      optionIds: z.array(z.string()).min(1),
      labels: z.array(z.string()).min(1),
    }),
    FillBaseSchema.extend({
      kind: z.literal("search"),
      query: z.string().min(1).max(200),
      target: z.string().min(1).max(200),
      location: LocationTargetSchema.optional(),
      /** A previously confirmed result, reused on restore without another AI call. */
      selection: z.string().min(1).max(LIMITS.option).optional(),
      selectionDescription: z.string().max(LIMITS.option).optional(),
    }),
    FillBaseSchema.extend({
      kind: z.literal("check"),
      checked: z.boolean(),
    }),
    FillBaseSchema.extend({ kind: z.literal("resume-file") }),
  ])
  .refine(
    (fill) =>
      fill.kind !== "options" || fill.optionIds.length === fill.labels.length,
    { message: "Each option id needs its label" }
  )
export type Fill = z.infer<typeof FillSchema>

export const QuestionSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(500),
  original: z
    .array(
      z.object({ fieldId: FieldIdSchema, label: z.string().max(LIMITS.label) })
    )
    .min(1),
  options: z
    .array(z.string().max(LIMITS.option))
    .max(LIMITS.options)
    .optional(),
  companySpecific: z.boolean(),
})
export type Question = z.infer<typeof QuestionSchema>

export const AutofillVendorSchema = z.enum(["greenhouse", "ashby", "lever"])
export type AutofillVendor = z.infer<typeof AutofillVendorSchema>

export const ZoneSchema = z.enum([
  "normal",
  "forbidden",
  "write",
  "resume-file",
  "other-file",
])
export type Zone = z.infer<typeof ZoneSchema>

/**
 * Where a field goes after classification:
 * - `rule`: has a value in `fills`.
 * - `pending`: waits for options that rules have a target for; counts as "may fill".
 * - `ai`: goes to `infer`.
 * - `write`: a written answer, settled by label rules.
 * - `page`: goes to "Fill these on the page".
 * - `skip`: optional, Profile-backed, and the Profile has no value.
 * - `filled`: already had a value; its rule value goes to `overwrites`.
 */
export const RouteSchema = z.enum([
  "rule",
  "pending",
  "ai",
  "write",
  "page",
  "skip",
  "filled",
])
export type Route = z.infer<typeof RouteSchema>

export const FieldClassSchema = z.object({
  fieldId: FieldIdSchema,
  key: CanonicalKeySchema.nullable(),
  zone: ZoneSchema,
  anchor: ProfileSectionSchema.optional(),
  route: RouteSchema,
})
export type FieldClass = z.infer<typeof FieldClassSchema>
