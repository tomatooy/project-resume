import {
  AutofillVendorSchema,
  FieldDescriptorSchema,
  LIMITS,
  ProfileSectionSchema,
  QuestionSchema,
} from "@workspace/autofill/fields"
import {
  JobMatchSchema,
  MissingAnswerSchema,
  NotesOutcomeSchema,
  PlanResultSchema,
  QuotaSchema,
  ResumeChoiceSchema,
  StartResultSchema,
} from "@workspace/resume-core/contracts"
import { z } from "zod"

/*
 * What the panel shows for an autofill page, and what it can ask for. The
 * service worker builds the view from the tab's session (spec 6).
 */

const FieldIdSchema = FieldDescriptorSchema.shape.id
const Count = z.number().int().min(0)

/** A field listed in one of the panel's groups. */
export const ItemSchema = z.object({
  fieldId: z.string(),
  label: z.string(),
  /** The Profile section that would answer it. */
  anchor: ProfileSectionSchema.nullable(),
  /** Rules have a value for it that would replace the page's. */
  overwrite: z.boolean(),
})
export type Item = z.infer<typeof ItemSchema>

export const AutofillViewSchema = z.object({
  postingKey: z.string().nullable().default(null),
  /** Null until the page's first scan arrives. */
  vendor: AutofillVendorSchema.nullable(),
  company: z.string().nullable(),
  title: z.string().nullable(),
  scanning: z.boolean(),
  form: z.boolean(),
  formLink: z.string().nullable(),
  fields: Count,
  ready: Count,
  filled: Count,
  ran: z.boolean(),
  running: z.boolean(),
  resume: z
    .object({ id: z.uuid(), choice: ResumeChoiceSchema.nullable() })
    .nullable(),
  job: PlanResultSchema.shape.job,
  jobMatch: JobMatchSchema,
  useAnyway: z.boolean(),
  earlier: PlanResultSchema.shape.earlier,
  missing: z.array(MissingAnswerSchema),
  quota: QuotaSchema.nullable(),
  degraded: z.boolean(),
  questions: z.array(QuestionSchema.extend({ unmatched: z.boolean() })),
  draft: z.string(),
  notes: z
    .object({
      outcome: NotesOutcomeSchema,
      canRetry: z.boolean(),
      undo: z.enum(["done", "refused"]).nullable(),
    })
    .nullable(),
  groups: z.object({
    page: z.array(ItemSchema),
    write: z.array(ItemSchema),
    ai: z.array(ItemSchema),
    filled: z.array(ItemSchema),
    already: z.array(ItemSchema),
  }),
  /** The resume the panel renders to a PDF for the resume field. */
  attach: z
    .object({
      versionId: z.uuid(),
      fileName: z.string(),
      document: StartResultSchema.shape.document,
    })
    .nullable(),
  attachFailed: z.boolean(),
})
export type AutofillView = z.infer<typeof AutofillViewSchema>
export type AutofillGroup = keyof AutofillView["groups"]

export const AutofillActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run") }),
  z.object({ kind: z.literal("resume"), resumeId: z.uuid() }),
  z.object({ kind: z.literal("use-anyway") }),
  z.object({
    kind: z.literal("answer"),
    text: z.string().trim().min(1).max(LIMITS.answer),
  }),
  z.object({ kind: z.literal("draft"), text: z.string().max(LIMITS.answer) }),
  z.object({ kind: z.literal("retry-notes") }),
  z.object({ kind: z.literal("undo-notes") }),
  z.object({ kind: z.literal("clear"), fieldId: FieldIdSchema }),
  z.object({ kind: z.literal("overwrite"), fieldId: FieldIdSchema }),
  z.object({ kind: z.literal("focus"), fieldId: FieldIdSchema }),
  z.object({ kind: z.literal("open-form") }),
  z.object({
    kind: z.literal("attach"),
    versionId: z.uuid(),
    base64: z.string().min(1),
  }),
  z.object({ kind: z.literal("attach-failed"), versionId: z.uuid() }),
])
export type AutofillAction = z.infer<typeof AutofillActionSchema>
