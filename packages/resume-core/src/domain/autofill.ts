import {
  AutofillVendorSchema,
  CanonicalKeySchema,
  DiffLineSchema,
  FieldClassSchema,
  FieldDescriptorSchema,
  FieldsSchema,
  FillSchema,
  LIMITS,
  LocationTargetSchema,
  OptionSchema,
  ProfileFieldKeySchema,
  ProfileSchema,
  ProfileSectionSchema,
  QuestionSchema,
} from "@workspace/autofill"
import {
  ResumeSchema,
  TemplateIdSchema,
  TemplateOptionsSchema,
} from "@workspace/resume-schema"
import { z } from "zod"

import { JobIdentitySchema } from "./job-identity"
import { JobBriefSchema } from "./resume"
import { QuotaSchema } from "./suggestion"

/** Why a Notes snapshot was taken (spec 8.3). */
export const NoteVersionReasonSchema = z.enum(["merge", "edit", "restore"])
export type NoteVersionReason = z.infer<typeof NoteVersionReasonSchema>

/** One History row. `length` is the snapshot's length in characters. */
export const NoteVersionSchema = z.object({
  id: z.uuid(),
  reason: NoteVersionReasonSchema,
  createdAt: z.string(),
  length: z.number().int(),
})
export type NoteVersion = z.infer<typeof NoteVersionSchema>

/** One snapshot with its text, for the History preview. */
export const NoteVersionContentSchema = NoteVersionSchema.omit({
  length: true,
}).extend({ content: z.string() })
export type NoteVersionContent = z.infer<typeof NoteVersionContentSchema>

/** The Profile page's state: the empty Profile at revision 0 before the first save. */
export const ProfileStateSchema = z.object({
  profile: ProfileSchema,
  revision: z.number().int().min(0),
  updatedAt: z.string().nullable(),
  exists: z.boolean(),
})
export type ProfileState = z.infer<typeof ProfileStateSchema>

/** The Notes and their concurrency token: revision 0 means no row yet. */
export const NotesStateSchema = z.object({
  content: z.string(),
  revision: z.number().int().min(0),
  updatedAt: z.string().nullable(),
})
export type NotesState = z.infer<typeof NotesStateSchema>

const Count = z.number().int().min(0)

/**
 * What a Notes merge did (spec 8.2): saved, with counts, a diff for Review and
 * the snapshot Undo restores; failed, which offers Retry; or full, when the
 * result would pass 10,000 characters and nothing was saved.
 */
export const NotesOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("saved"),
    added: Count,
    changed: Count,
    deleted: Count,
    undoVersionId: z.uuid().nullable(),
    revision: z.number().int(),
    diff: z.array(DiffLineSchema),
    hints: z.array(ProfileFieldKeySchema),
  }),
  z.object({ kind: z.literal("failed") }),
  z.object({ kind: z.literal("full"), hints: z.array(ProfileFieldKeySchema) }),
])
export type NotesOutcome = z.infer<typeof NotesOutcomeSchema>

/**
 * The posting a form belongs to, as the content script reads it. Posting keys
 * are `{vendor}:{org}:{jobId}`. A weak company is a guess from the URL slug,
 * so it never picks a resume or decides a job match.
 */
export const AutofillPageSchema = z.object({
  vendor: AutofillVendorSchema,
  postingKey: z.string().min(1).max(300),
  url: z.url().max(2000),
  company: z.string().min(1).max(200).nullable(),
  companyWeak: z.boolean(),
  title: z.string().min(1).max(300).nullable(),
})
export type AutofillPage = z.infer<typeof AutofillPageSchema>

/** Which default rule picked the resume (spec 6.2), or the user's own pick. */
export const ResumeChoiceSchema = z.enum([
  "linkedin",
  "company",
  "last",
  "recent",
  "user",
])
export type ResumeChoice = z.infer<typeof ResumeChoiceSchema>

/**
 * How the resume's job compares with the page (spec 6.3): no job, the same
 * company, another company, or a page whose company is unknown or weak.
 */
export const JobMatchSchema = z.enum(["none", "match", "mismatch", "unknown"])
export type JobMatch = z.infer<typeof JobMatchSchema>

/** A common answer neither the Profile nor the resume gives (spec 6.5). */
export const MissingAnswerSchema = z.object({
  key: CanonicalKeySchema,
  anchor: ProfileSectionSchema,
})
export type MissingAnswer = z.infer<typeof MissingAnswerSchema>

/** A session's tallies, kept on the application record (spec 14.4). */
export const CountsSchema = z.object({
  fields: Count,
  rules: Count,
  ai: Count,
  asked: Count,
  drafted: Count,
})
export type Counts = z.infer<typeof CountsSchema>

export const PlanInputSchema = z.object({
  page: AutofillPageSchema,
  fields: FieldsSchema,
  resumeId: z.uuid().nullable(),
  linkedin: JobIdentitySchema.nullable(),
})
export type PlanInput = z.infer<typeof PlanInputSchema>

export const PlanResultSchema = z.object({
  resumeId: z.uuid().nullable(),
  resumeChoice: ResumeChoiceSchema.nullable(),
  job: JobBriefSchema.nullable(),
  jobMatch: JobMatchSchema,
  fills: z.array(FillSchema),
  overwrites: z.array(FillSchema),
  classes: z.array(FieldClassSchema),
  earlier: z
    .object({ at: z.string(), resumeTitle: z.string().nullable() })
    .nullable(),
  missing: z.array(MissingAnswerSchema),
  quota: QuotaSchema,
})
export type PlanResult = z.infer<typeof PlanResultSchema>

export const StartInputSchema = z.object({
  page: AutofillPageSchema,
  resumeId: z.uuid(),
  useJob: z.boolean(),
})
export type StartInput = z.infer<typeof StartInputSchema>

/** The snapshot's document, which the extension renders into the PDF it uploads. */
export const StartResultSchema = z.object({
  applicationId: z.uuid(),
  versionId: z.uuid(),
  fileName: z.string(),
  document: z.object({
    data: ResumeSchema,
    templateId: TemplateIdSchema,
    templateOptions: TemplateOptionsSchema,
  }),
})
export type StartResult = z.infer<typeof StartResultSchema>

/**
 * What every AI call carries. `useJob` is false until the user accepts a
 * mismatched job, and then no job description reaches a model.
 */
export const AiRequestSchema = z.object({
  page: AutofillPageSchema,
  resumeId: z.uuid(),
  applicationId: z.uuid(),
  useJob: z.boolean(),
  counts: CountsSchema,
})
export type AiRequest = z.infer<typeof AiRequestSchema>

export const InferInputSchema = AiRequestSchema.extend({ fields: FieldsSchema })
export type InferInput = z.infer<typeof InferInputSchema>

export const InferResultSchema = z.object({
  fills: z.array(FillSchema),
  write: z.array(z.string()),
  page: z.array(z.string()),
  questions: z.array(QuestionSchema),
  degraded: z.boolean(),
  quota: QuotaSchema,
})
export type InferResult = z.infer<typeof InferResultSchema>

export const ResolveLocationInputSchema = AiRequestSchema.extend({
  target: LocationTargetSchema,
  options: z
    .array(OptionSchema)
    .min(1)
    .max(20)
    .refine(
      (options) => new Set(options.map(({ id }) => id)).size === options.length,
      { message: "Option ids must be unique" }
    ),
})
export type ResolveLocationInput = z.infer<typeof ResolveLocationInputSchema>

export const ResolveLocationResultSchema = z.object({
  option: OptionSchema.nullable(),
  quota: QuotaSchema,
})
export type ResolveLocationResult = z.infer<typeof ResolveLocationResultSchema>

export const AnswerInputSchema = AiRequestSchema.extend({
  fields: FieldsSchema,
  questions: z.array(QuestionSchema).max(200),
  text: z.string().trim().min(1).max(LIMITS.answer),
})
export type AnswerInput = z.infer<typeof AnswerInputSchema>

export const AnswerResultSchema = z.object({
  fills: z.array(FillSchema),
  unmatched: z.array(z.string()),
  notes: NotesOutcomeSchema,
  quota: QuotaSchema,
})
export type AnswerResult = z.infer<typeof AnswerResultSchema>

export const GenerateInputSchema = AiRequestSchema.extend({
  field: FieldDescriptorSchema,
  instruction: z.string().trim().max(LIMITS.instruction).optional(),
})
export type GenerateInput = z.infer<typeof GenerateInputSchema>

export const GenerateResultSchema = z.object({
  text: z.string(),
  quota: QuotaSchema,
})
export type GenerateResult = z.infer<typeof GenerateResultSchema>

export const NotesMergeInputSchema = z.object({
  page: AutofillPageSchema,
  resumeId: z.uuid(),
  questions: z.array(QuestionSchema).max(200),
  text: z.string().trim().min(1).max(LIMITS.answer),
})
export type NotesMergeInput = z.infer<typeof NotesMergeInputSchema>

export const NotesMergeResultSchema = z.object({
  notes: NotesOutcomeSchema,
  quota: QuotaSchema,
})
export type NotesMergeResult = z.infer<typeof NotesMergeResultSchema>

export const NotesUndoInputSchema = z.object({
  versionId: z.uuid(),
  revision: z.number().int().min(1),
})
export type NotesUndoInput = z.infer<typeof NotesUndoInputSchema>

/** Undo restores only while the Notes are as the merge left them. */
export const NotesUndoResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("restored"), revision: z.number().int() }),
  z.object({ kind: z.literal("changed") }),
])
export type NotesUndoResult = z.infer<typeof NotesUndoResultSchema>
