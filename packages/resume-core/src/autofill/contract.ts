import { z } from "zod"
import { AutofillProfileSchema } from "../autofill-profile/schema"
import { ConceptSchema } from "./concept"
import { InterpretedPageSchema, PageViewSchema } from "./page-contract"
export { ConceptSchema, type Concept } from "./concept"
import {
  ResumeSchema,
  TemplateIdSchema,
  TemplateOptionsSchema,
} from "@workspace/resume-schema"

export const AUTOFILL_LIMITS = {
  fields: 200,
  questions: 40,
  options: 200,
  bodyBytes: 262144,
  modelMs: 15000,
  planMs: 30000,
  stepMs: 8000,
  queries: 3,
  scrolls: 5,
  rescans: 3,
  attempts: 8,
  runMs: 120000,
  planTtl: 30000,
  sessionTtl: 1800000,
  uploadBytes: 5 * 1024 * 1024,
} as const
const id = z.string().min(1).max(150)
const revision = z.number().int().nonnegative()
const label = z.string().max(1000)
export const SourceStampSchema = z.strictObject({
  resumeId: z.uuid(),
  resumeSource: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("head"),
      revision,
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    z.strictObject({
      kind: z.literal("version"),
      versionId: z.uuid(),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ]),
  profileRevision: revision,
  overridesRevision: revision,
})
export type SourceStamp = z.infer<typeof SourceStampSchema>
const sourceField = { key: id, recordId: id.optional() }
export const SourceRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...sourceField,
    kind: z.literal("resume_head"),
    resumeId: z.uuid(),
    revision,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({
    ...sourceField,
    kind: z.literal("resume_version"),
    resumeId: z.uuid(),
    versionId: z.uuid(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({
    ...sourceField,
    kind: z.literal("autofill_profile"),
    revision,
  }),
  z.strictObject({
    ...sourceField,
    kind: z.literal("session_override"),
    overrideId: z.uuid(),
    revision,
  }),
  z.strictObject({
    ...sourceField,
    kind: z.literal("application_answer"),
    answerId: z.uuid(),
    applicationId: id,
  }),
  z.strictObject({
    ...sourceField,
    kind: z.literal("scoped_answer"),
    answerId: z.uuid(),
    revision,
  }),
  z.strictObject({
    ...sourceField,
    kind: z.literal("application_record"),
    applicationId: id,
  }),
])
export const AnswerConditionsSchema = z.strictObject({
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  employerId: z.string().trim().min(1).max(500).optional(),
  jobId: z.string().trim().min(1).max(500).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  salaryPeriod: z.enum(["hour", "month", "year"]).optional(),
})
export type AnswerConditions = z.infer<typeof AnswerConditionsSchema>
export const ApplicationContextSchema = AnswerConditionsSchema.extend({
  applicationId: id,
})
export type ApplicationContext = z.infer<typeof ApplicationContextSchema>
export const AnswerMeaningSchema = z
  .strictObject({
    concept: ConceptSchema,
    questionKey: z.string().min(1).max(4000).optional(),
    definitionVersion: id.optional(),
  })
  .refine(
    (m) =>
      (m.concept !== "open_answer" && !m.concept.startsWith("eeo_")) ||
      Boolean(m.questionKey),
    "This answer needs an exact question"
  )
  .refine(
    (m) => !m.concept.startsWith("eeo_") || Boolean(m.definitionVersion),
    "EEO answers need a question definition"
  )
export type AnswerMeaning = z.infer<typeof AnswerMeaningSchema>
export const AnswerProvenanceSchema = z.strictObject({
  kind: z.enum(["user", "confirmed_draft"]),
  sourceRefs: z.array(SourceRefSchema).max(50).optional(),
  sourceStamp: SourceStampSchema.optional(),
})
export const ApplicationAnswerSchema = z.strictObject({
  answerId: z.uuid(),
  applicationId: id,
  meaning: AnswerMeaningSchema,
  conditions: AnswerConditionsSchema,
  recordId: id.optional(),
  value: z.string().trim().min(1).max(4000),
  confirmed: z.literal(true),
  provenance: AnswerProvenanceSchema,
})
export type ApplicationAnswer = z.infer<typeof ApplicationAnswerSchema>
export const ScopedAnswerSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
  meaning: AnswerMeaningSchema,
  conditions: AnswerConditionsSchema,
  value: z.string().trim().min(1).max(4000),
  provenance: AnswerProvenanceSchema,
  confirmedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type ScopedAnswer = z.infer<typeof ScopedAnswerSchema>
export const SaveScopedAnswerSchema = z.strictObject({
  id: z.uuid().optional(),
  expectedRevision: revision,
  meaning: AnswerMeaningSchema,
  conditions: AnswerConditionsSchema,
  value: z.string().trim().min(1).max(4000),
  provenance: AnswerProvenanceSchema,
  confirmed: z.literal(true),
})
export type SaveScopedAnswer = z.infer<typeof SaveScopedAnswerSchema>
export const DeleteScopedAnswerSchema = z.strictObject({
  id: z.uuid(),
  expectedRevision: revision,
})
export type DeleteScopedAnswer = z.infer<typeof DeleteScopedAnswerSchema>
const [experienceRecord, educationRecord] =
  ResumeSchema.shape.sections.element.shape.items.element.options
export const SupplementalRecordSchema = z.strictObject({
  applicationId: id,
  confirmed: z.literal(true),
  record: z.discriminatedUnion("kind", [experienceRecord, educationRecord]),
})
export type SupplementalRecord = z.infer<typeof SupplementalRecordSchema>
export const SourceSnapshotSchema = z.strictObject({
  sourceStamp: SourceStampSchema,
  resume: ResumeSchema,
  profile: AutofillProfileSchema,
  templateId: TemplateIdSchema,
  templateOptions: TemplateOptionsSchema,
  scopedAnswers: z.array(ScopedAnswerSchema).max(500),
})
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>
export const FactSchema = z.strictObject({
  factId: id,
  concept: ConceptSchema,
  value: z.string().max(4000),
  sourceRef: SourceRefSchema,
  recordId: id.optional(),
  sourceLabel: label,
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  sensitive: z.boolean(),
  aliases: z.array(z.string().max(500)).max(20),
  conditions: AnswerConditionsSchema.optional(),
})
export type Fact = z.infer<typeof FactSchema>
export const TargetSchema = z.strictObject({
  tabId: z.number().int().nonnegative(),
  frameId: z.number().int().nonnegative(),
  documentId: id,
  origin: z
    .url()
    .max(2000)
    .refine(
      (v) =>
        new URL(v).origin === v &&
        (v.startsWith("https://") || /^http:\/\/localhost(?::\d+)?$/.test(v))
    ),
  formId: id,
})
export const BindingSchema = z.strictObject({
  semanticKey: ConceptSchema,
  recordId: id.optional(),
  factId: id,
})
export const OptionSchema = z.strictObject({
  optionId: id,
  label,
  description: z.string().max(1000).default(""),
  disabled: z.boolean(),
  placeholder: z.boolean(),
  selected: z.boolean(),
})
export const OptionSnapshotSchema = z.strictObject({
  fieldId: id,
  fieldRevision: revision,
  optionsRevision: revision,
  queryRevision: revision,
  query: z.string().max(500),
  loadState: z.enum(["idle", "loading", "ready", "error"]),
  coverage: z.enum(["complete", "partial", "unknown"]),
  hasMore: z.boolean().nullable(),
  canSearch: z.boolean(),
  canScroll: z.boolean(),
  options: z.array(OptionSchema).max(200),
  bindingRef: BindingSchema.optional(),
})
export type OptionSnapshot = z.infer<typeof OptionSnapshotSchema>
export const FieldSnapshotSchema = z.strictObject({
  fieldId: id,
  fieldRevision: revision,
  control: z.enum([
    "text",
    "textarea",
    "date",
    "month",
    "single_select",
    "multi_select",
    "radio_group",
    "checkbox",
    "checkbox_group",
    "file",
    "unsupported",
  ]),
  label,
  description: z.string().max(2000),
  section: label,
  groupId: id.optional(),
  attributes: z.strictObject({
    type: z.string().max(100).optional(),
    name: z.string().max(200).optional(),
    autocomplete: z.string().max(200).optional(),
    placeholder: z.string().max(500).optional(),
    inputmode: z.string().max(100).optional(),
    accept: z.string().max(500).optional(),
  }),
  constraints: z.strictObject({
    required: z.boolean(),
    maxLength: z.number().int().nonnegative().optional(),
    pattern: z.string().max(500).optional(),
    min: z.string().max(100).optional(),
    max: z.string().max(100).optional(),
  }),
  state: z.strictObject({
    visible: z.boolean(),
    editable: z.boolean(),
    empty: z.boolean(),
    hasUserValue: z.boolean(),
    validationState: z.enum(["valid", "invalid", "unknown"]),
    truncated: z.boolean(),
    commitState: z.enum(["known", "unknown"]).optional(),
  }),
  userEditEpoch: revision,
  options: OptionSnapshotSchema.optional(),
  capabilities: z.strictObject({
    adapterId: id,
    read: z.boolean(),
    write: z.boolean(),
    discover: z.boolean(),
    search: z.boolean(),
    scroll: z.boolean(),
    verify: z.boolean(),
  }),
  guardRef: id,
})
export type FieldSnapshot = z.infer<typeof FieldSnapshotSchema>
export const FormSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    snapshotId: id,
    documentEpoch: revision,
    formRevision: revision,
    formId: id,
    formLabel: label,
    fields: z.array(FieldSnapshotSchema).max(200),
    groups: z
      .array(
        z.strictObject({
          groupId: id,
          label,
          kind: z.enum(["experience", "education", "other"]),
        })
      )
      .max(200),
    coverage: z.enum(["complete", "partial"]),
    coverageReasons: z
      .array(
        z.enum([
          "inaccessible_frame",
          "truncated",
          "closed_shadow",
          "unsupported",
        ])
      )
      .max(4),
    observedAt: z.iso.datetime(),
    pageView: PageViewSchema.optional(),
  })
  .refine(
    (s) => new Set(s.fields.map((f) => f.fieldId)).size === s.fields.length,
    "Duplicate field identity"
  )
export type FormSnapshot = z.infer<typeof FormSnapshotSchema>
export const PolicySchema = z.strictObject({
  version: id,
  expiresAt: z.iso.datetime(),
  enabled: z.boolean(),
  jevEnabled: z.boolean(),
  model: z.literal("jev-1.13.0"),
  autoRules: z.array(id).max(200),
  autoModel: z
    .array(
      z.strictObject({
        kind: z.enum(["semantic", "record", "option"]),
        language: z.string().max(20),
        adapterId: id,
        probability: z.number().min(0).max(1),
        margin: z.number().min(0).max(1),
      })
    )
    .max(200),
  disabledAdapters: z.array(id).max(100),
})
export type AutofillPolicy = z.infer<typeof PolicySchema>
export function reviewPolicy(now = new Date()): AutofillPolicy {
  return {
    version: "autofill-v1-review",
    expiresAt: new Date(now.getTime() + 60000).toISOString(),
    enabled: true,
    jevEnabled: false,
    model: "jev-1.13.0",
    autoRules: [],
    autoModel: [],
    disabledAdapters: [],
  }
}
export const SelectionSchema = z.strictObject({
  fieldId: id,
  fieldRevision: revision,
  concept: ConceptSchema,
  recordId: id.optional(),
  optionIds: z.array(id).max(200).optional(),
  optionsRevision: revision.optional(),
  queryRevision: revision.optional(),
  confirmed: z.boolean(),
  replace: z.boolean(),
  guardRef: id,
  profileRevision: revision,
})
export const OverrideSchema = z.strictObject({
  overrideId: z.uuid(),
  concept: ConceptSchema,
  fieldId: id,
  documentId: id.optional(),
  value: z.string().min(1).max(4000),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
})
export const PlanInputSchema = z.strictObject({
  automation: z.enum(["automatic", "review"]).optional(),
  schemaVersion: z.literal(1),
  requestId: z.uuid(),
  sessionId: z.uuid(),
  generation: revision,
  sourceStamp: SourceStampSchema,
  sourceSnapshot: SourceSnapshotSchema.optional(),
  applicationContext: ApplicationContextSchema.optional(),
  applicationAnswers: z.array(ApplicationAnswerSchema).max(200).optional(),
  supplementalRecords: z.array(SupplementalRecordSchema).max(100).optional(),
  recordBindings: z
    .array(z.strictObject({ groupId: id, recordId: id }))
    .max(200)
    .optional(),
  pageView: PageViewSchema.optional(),
  target: TargetSchema,
  snapshot: FormSnapshotSchema,
  selections: z.array(SelectionSchema).max(200),
  overrides: z.array(OverrideSchema).max(200),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  remainingAttempts: z.number().int().min(0).max(8),
})
export type PlanInput = z.infer<typeof PlanInputSchema>
const actionBase = {
  actionId: z.uuid(),
  decisionId: z.uuid(),
  fieldId: id,
  fieldRevision: revision,
  guardRef: id,
  precondition: z.enum(["empty", "explicit_replace"]),
  userEditEpoch: revision,
}
export const ActionSchema = z.discriminatedUnion("op", [
  z.strictObject({
    ...actionBase,
    op: z.literal("upload_resume"),
    mimeType: z.literal("application/pdf"),
  }),
  z.strictObject({
    ...actionBase,
    op: z.literal("set_text"),
    value: z.string().max(4000),
    format: z.enum(["plain", "email", "phone", "url", "iso_date", "iso_month"]),
  }),
  z.strictObject({
    ...actionBase,
    op: z.literal("set_single"),
    optionId: id,
    optionsRevision: revision,
    queryRevision: revision,
  }),
  z.strictObject({
    ...actionBase,
    op: z.literal("set_multiple"),
    optionIds: z.array(id).max(200),
    optionsRevision: revision,
    queryRevision: revision,
  }),
  z.strictObject({
    ...actionBase,
    op: z.literal("set_checked"),
    checked: z.boolean(),
  }),
])
export type FillAction = z.infer<typeof ActionSchema>
export const AutofillDocumentInputSchema = z.strictObject({
  sourceStamp: SourceStampSchema,
  sourceSnapshot: SourceSnapshotSchema.optional(),
})
export const DraftAnswerInputSchema = z.strictObject({
  sourceStamp: SourceStampSchema,
  sourceSnapshot: SourceSnapshotSchema.optional(),
  target: TargetSchema,
  field: FieldSnapshotSchema,
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  applicationContext: ApplicationContextSchema.optional(),
  applicationAnswers: z.array(ApplicationAnswerSchema).max(200).optional(),
  supplementalRecords: z.array(SupplementalRecordSchema).max(100).optional(),
})
export type DraftAnswerInput = z.infer<typeof DraftAnswerInputSchema>
export const AutofillDocumentSchema = z.strictObject({
  sourceStamp: SourceStampSchema,
  resume: ResumeSchema,
  templateId: TemplateIdSchema,
  templateOptions: TemplateOptionsSchema,
})
export type AutofillDocument = z.infer<typeof AutofillDocumentSchema>
const envelope = {
  schemaVersion: z.literal(1),
  planId: z.uuid(),
  sessionId: z.uuid(),
  generation: revision,
  sourceStamp: SourceStampSchema,
  target: TargetSchema,
  snapshotId: id,
  documentEpoch: revision,
  formRevision: revision,
  expiresAt: z.iso.datetime(),
}
export const InteractionSchema = z.strictObject({
  interactionId: z.uuid(),
  kind: z.literal("discover_options"),
  fieldId: id,
  fieldRevision: revision,
  guardRef: id,
  bindingRef: BindingSchema,
  queries: z.array(z.string().min(1).max(500)).max(3),
  maxQueries: z.number().int().min(0).max(3),
  maxScrollPages: z.number().int().min(0).max(5),
})
export const FillPlanSchema = z.strictObject({
  ...envelope,
  actions: z.array(ActionSchema).max(200),
  interactions: z.array(InteractionSchema).max(200),
})
export type FillPlan = z.infer<typeof FillPlanSchema>
export const DecisionSchema = z.strictObject({
  decisionId: z.uuid(),
  fieldId: id,
  fieldRevision: revision,
  status: z.enum([
    "resolved",
    "needs_interaction",
    "review",
    "missing_data",
    "unmapped",
    "needs_draft",
    "preserved",
    "blocked",
    "unsupported",
    "failed",
  ]),
  reasonCode: id,
  semanticKey: ConceptSchema.optional(),
  meaning: AnswerMeaningSchema.optional(),
  conditions: AnswerConditionsSchema.optional(),
  factId: id.optional(),
  sourceRef: SourceRefSchema.optional(),
  recordId: id.optional(),
  optionIds: z.array(id).max(200).optional(),
  label,
  value: z.string().max(4000).optional(),
  sourceLabel: label.optional(),
  candidates: z.array(z.strictObject({ id, label })).max(200).optional(),
  provenance: z
    .strictObject({
      ruleId: id.optional(),
      model: id.optional(),
      questionVersion: id.optional(),
      probability: z.number().min(0).max(1).optional(),
      margin: z.number().min(0).max(1).optional(),
    })
    .optional(),
})
export type FieldDecision = z.infer<typeof DecisionSchema>
export const AutofillPlanOutputSchema = z.strictObject({
  requestId: z.uuid(),
  sessionId: z.uuid(),
  generation: revision,
  snapshotId: id,
  decisions: z.array(DecisionSchema).max(200),
  plan: FillPlanSchema,
  policy: PolicySchema,
  attempts: z.number().int().min(0).max(8),
  interpretation: InterpretedPageSchema.optional(),
})
export type AutofillPlanOutput = z.infer<typeof AutofillPlanOutputSchema>
export const PrepareInputSchema = z.strictObject({
  resumeId: z.uuid(),
  versionId: z.uuid().optional(),
})
export const PrepareOutputSchema = z.strictObject({
  sourceStamp: SourceStampSchema,
  sourceSnapshot: SourceSnapshotSchema.optional(),
  title: label,
  availableConcepts: z.array(ConceptSchema),
  missingConcepts: z.array(ConceptSchema),
  policy: PolicySchema,
})
export const ActionResultSchema = z.strictObject({
  actionId: z.uuid(),
  fieldId: id,
  status: z.enum([
    "filled",
    "already_applied",
    "skipped",
    "stale",
    "unsupported",
    "failed",
    "unverified",
  ]),
  reasonCode: id,
  verification: z.enum([
    "accepted",
    "rejected",
    "unobservable",
    "not_attempted",
  ]),
  durationMs: z.number().nonnegative(),
  observedFieldRevision: revision,
})
export type ActionResult = z.infer<typeof ActionResultSchema>
export const ExecutionReportSchema = z.strictObject({
  planId: z.uuid(),
  sessionId: z.uuid(),
  generation: revision,
  results: z.array(ActionResultSchema).max(200),
  rescan: z.array(id).max(200),
})
