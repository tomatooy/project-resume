import { z } from "zod"
import { ResumePdfSchema } from "./pdf-contract"
import {
  ActionSchema,
  ActionResultSchema,
  FormSnapshotSchema,
  FillPlanSchema,
  InteractionSchema,
  SourceStampSchema,
  DecisionSchema,
  SelectionSchema,
  OverrideSchema,
  PolicySchema,
  ResumeSummarySchema,
  SourceSnapshotSchema,
  ApplicationContextSchema,
  ApplicationAnswerSchema,
  AnswerConditionsSchema,
  SupplementalRecordSchema,
  ContextReadSchema,
} from "@workspace/resume-core/contracts"

export const PROTOCOL = 1
export const AutoLaunchMessageSchema = z.strictObject({
  type: z.literal("af.ready"),
  protocolVersion: z.literal(1),
})
const correlation = {
  protocolVersion: z.literal(1),
  sessionId: z.uuid(),
  generation: z.number().int().nonnegative(),
  requestId: z.uuid(),
  instanceId: z.uuid(),
}
export const ContentCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("af.hello"),
    protocolVersion: z.literal(1),
  }),
  z.strictObject({
    type: z.literal("af.bootstrap"),
    protocolVersion: z.literal(1),
    instanceId: z.uuid(),
    panelNonce: z.uuid().optional(),
    documentId: z.string(),
    documentEpoch: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...correlation,
    type: z.literal("af.preview"),
    fieldId: z.string().max(150),
  }),
  z.strictObject({
    ...correlation,
    type: z.literal("af.observe"),
    formId: z.string().optional(),
    contextRequests: z.array(ContextReadSchema).max(8).optional(),
  }),
  z.strictObject({
    ...correlation,
    type: z.literal("af.addRecord"),
    entryRef: z.string().min(1).max(150),
    entryRevision: z.number().int().nonnegative(),
    kind: z.enum(["experience", "education"]),
  }),
  z.strictObject({
    ...correlation,
    type: z.literal("af.execute"),
    file: ResumePdfSchema.optional(),
    plan: FillPlanSchema,
    action: ActionSchema,
    replacement: SelectionSchema.optional(),
    policy: PolicySchema,
  }),
  z.strictObject({
    ...correlation,
    type: z.literal("af.discover"),
    plan: FillPlanSchema,
    interaction: InteractionSchema,
  }),
  z.strictObject({ ...correlation, type: z.literal("af.audit") }),
  z.strictObject({ ...correlation, type: z.literal("af.cancel") }),
  z.strictObject({ ...correlation, type: z.literal("af.release") }),
])
export type ContentCommand = z.infer<typeof ContentCommandSchema>
export const ObservationSchema = z.strictObject({
  forms: z
    .array(
      z.strictObject({
        id: z.string(),
        label: z.string().max(1000),
        fields: z.number(),
      })
    )
    .max(200),
  snapshot: FormSnapshotSchema.nullable(),
  uncovered: z.boolean(),
  recordEntrypoints: z
    .array(
      z.strictObject({
        entryRef: z.string().min(1).max(150),
        entryRevision: z.number().int().nonnegative(),
        kind: z.enum(["experience", "education"]),
        label: z.string().max(1000),
      })
    )
    .max(50)
    .default([]),
})
export type Observation = z.infer<typeof ObservationSchema>
const panelSession = {
  sessionId: z.uuid(),
  generation: z.number().int().nonnegative(),
  requestId: z.uuid(),
}
export const PanelCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("af.close"),
    protocolVersion: z.literal(1),
    nonce: z.uuid(),
  }),
  z.strictObject({
    ...panelSession,
    type: z.literal("af.preview"),
    protocolVersion: z.literal(1),
    nonce: z.uuid(),
    fieldId: z.string().max(150),
  }),
  z.strictObject({
    type: z.literal("af.connect"),
    protocolVersion: z.literal(1),
    nonce: z.uuid(),
  }),
  z.strictObject({
    type: z.literal("af.state"),
    protocolVersion: z.literal(1),
    nonce: z.uuid(),
  }),
  z.strictObject({
    type: z.literal("af.start"),
    protocolVersion: z.literal(1),
    nonce: z.uuid(),
    resumeId: z.uuid(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    salaryPeriod: z.enum(["hour", "month", "year"]).optional(),
    formId: z.string().optional(),
    frameId: z.literal(0).optional(),
  }),
  z.strictObject({
    ...panelSession,
    type: z.literal("af.continue"),
    protocolVersion: z.literal(1),
    nonce: z.uuid(),
    selection: SelectionSchema.optional(),
    override: OverrideSchema.optional(),
    confirmations: z
      .array(
        z.strictObject({
          selection: SelectionSchema,
          override: OverrideSchema.optional(),
        })
      )
      .max(200)
      .optional(),
    supplementalRecord: SupplementalRecordSchema.optional(),
  }),
  z.strictObject({
    ...panelSession,
    type: z.literal("af.captureAnswer"),
    protocolVersion: z.literal(1),
    nonce: z.uuid(),
    fieldId: z.string().min(1).max(150),
    concept: SelectionSchema.shape.concept,
    confirmed: z.literal(true),
  }),
  z.strictObject({
    ...panelSession,
    type: z.literal("af.saveAnswer"),
    protocolVersion: z.literal(1),
    nonce: z.uuid(),
    answerId: z.uuid(),
    destination: z.enum(["profile", "scoped"]),
    conditions: AnswerConditionsSchema.optional(),
    confirmed: z.literal(true),
  }),
  z.strictObject({
    ...panelSession,
    type: z.literal("af.draft"),
    protocolVersion: z.literal(1),
    nonce: z.uuid(),
    fieldId: z.string().min(1).max(150),
  }),
  z.strictObject({
    ...panelSession,
    type: z.literal("af.cancel"),
    protocolVersion: z.literal(1),
    nonce: z.uuid(),
  }),
  z.strictObject({
    type: z.literal("af.profile"),
    protocolVersion: z.literal(1),
    nonce: z.uuid(),
    section: z.enum([
      "identity",
      "links",
      "address",
      "workAuthorization",
      "eeo",
      "preferences",
      "aliases",
    ]),
  }),
  z.strictObject({
    type: z.literal("af.resumes"),
    protocolVersion: z.literal(1),
    nonce: z.uuid(),
    cursor: z.string().max(128).optional(),
  }),
])
export type PanelCommand = z.infer<typeof PanelCommandSchema>
export const ReplacementPreviewSchema = z.strictObject({
  fieldId: z.string(),
  fieldRevision: z.number(),
  guardRef: z.string(),
  value: z.string().max(4000),
})
export const SessionSchema = z.strictObject({
  id: z.uuid(),
  generation: z.number().int().nonnegative(),
  accountId: z.string(),
  resumeId: z.uuid(),
  sourceStamp: SourceStampSchema.nullable(),
  sourceSnapshot: SourceSnapshotSchema.nullable().default(null),
  applicationKey: z.string().max(2000).nullable().default(null),
  applicationContext: ApplicationContextSchema.optional(),
  applicationAnswers: z.array(ApplicationAnswerSchema).max(200).default([]),
  supplementalRecords: z.array(SupplementalRecordSchema).max(100).default([]),
  savedAnswerIds: z.array(z.uuid()).max(200).default([]),
  drafts: z
    .array(
      z.strictObject({
        fieldId: z.string(),
        question: z.string().max(4000),
        text: z.string().max(4000),
        factIds: z.array(z.string()).max(50),
        missingInformation: z.array(z.string()).max(30).default([]),
      })
    )
    .max(100)
    .default([]),
  tabId: z.number().int(),
  frameId: z.number().int(),
  documentId: z.string(),
  instanceId: z.uuid(),
  origin: z.string(),
  documentEpoch: z.number().int(),
  formId: z.string().optional(),
  countryCode: z.string().optional(),
  status: z.enum([
    "idle",
    "preparing",
    "observing",
    "planning",
    "executing",
    "interacting",
    "paused",
    "stopping",
    "cancelled",
    "completed",
  ]),
  message: z.string(),
  updatedAt: z.number(),
  decisions: z.array(DecisionSchema),
  results: z.array(ActionResultSchema),
  selections: z.array(SelectionSchema),
  overrides: z.array(OverrideSchema),
  observation: ObservationSchema.nullable(),
  attempts: z.number().int(),
  replacementPreview: ReplacementPreviewSchema.nullable().default(null),
  replacementPreviews: z.array(ReplacementPreviewSchema).max(200).default([]),
})
export type AutofillSession = z.infer<typeof SessionSchema>
export const PanelStateSchema = z.strictObject({
  origin: z.string(),
  account: z.strictObject({ id: z.string(), email: z.string() }).nullable(),
  resumes: z.array(ResumeSummarySchema),
  nextCursor: z.string().nullable(),
  preselected: z.string().nullable(),
  session: SessionSchema.nullable(),
})
export type PanelState = z.infer<typeof PanelStateSchema>
const PanelErrorCodeSchema = z.enum([
  "session",
  "auth",
  "service",
  "connection",
  "unavailable",
  "engine",
])
type PanelErrorCode = z.infer<typeof PanelErrorCodeSchema>
const panelErrors: Record<PanelErrorCode, string> = {
  session:
    "This panel's session has expired or the page changed. Reopen Autofill from this tab's toolbar.",
  auth: "Your account connection needs to be renewed. Connect your account to continue.",
  service:
    "Could not load your saved resumes. Check your connection and retry here.",
  connection:
    "Could not connect to the extension. Reload the application page and try again.",
  unavailable: "Could not complete this action. Retry in this panel.",
  engine:
    "Filling is unavailable in this build while the page reader is replaced. This page was not changed.",
}
export class AutofillPanelError extends Error {
  constructor(readonly code: PanelErrorCode) {
    super(panelErrors[code])
  }
}
export const PanelReplySchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), state: PanelStateSchema }),
  z.strictObject({
    ok: z.literal(false),
    message: z.string(),
    code: PanelErrorCodeSchema.optional().default("unavailable"),
  }),
])
export async function sendAutofill(command: PanelCommand): Promise<PanelState> {
  try {
    const reply = PanelReplySchema.parse(
      await chrome.runtime.sendMessage(command)
    )
    if (!reply.ok) throw new AutofillPanelError(reply.code)
    return reply.state
  } catch (error) {
    throw error instanceof AutofillPanelError
      ? error
      : new AutofillPanelError("connection")
  }
}
