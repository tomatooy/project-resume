import {
  ResumePageSchema,
  ResumePreviewSchema,
  ResumePageInputSchema,
  TailorInstructionsSchema,
} from "@workspace/resume-core/contracts"
import { z } from "zod"
import {
  JobIdentitySchema,
  JobLookupSchema,
  ResumeSummarySchema,
} from "@workspace/resume-core/contracts"
import { ProfileSectionSchema } from "@workspace/autofill/fields"
import { AutofillActionSchema, AutofillViewSchema } from "./autofill-view"
import { AtsVendorSchema } from "./pages"

export const PageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unsupported") }),
  z.object({ kind: z.literal("select-job") }),
  z.object({
    kind: z.literal("job"),
    identity: JobIdentitySchema,
    sourceUrl: z.string(),
  }),
  z.object({ kind: z.literal("ats"), vendor: AtsVendorSchema }),
])
export const SnapshotSchema = z.object({
  tabId: z.number().nullable().default(null),
  page: PageSchema,
  account: z.object({ id: z.string(), email: z.string() }).nullable(),
  lookup: JobLookupSchema.nullable(),
  canApply: z.boolean().optional(),
  resumes: z.array(ResumeSummarySchema),
  nextResumeCursor: z.string().nullable().default(null),
  lastBaseId: z.string().nullable(),
  autofill: AutofillViewSchema.nullable().default(null),
})
export type Snapshot = z.infer<typeof SnapshotSchema>
const AutofillPreviewRequestSchema = z.object({
  accountId: z.string(),
  resumeId: z.uuid(),
  postingKey: z.string().min(1),
})
export type AutofillPreviewRequest = z.infer<
  typeof AutofillPreviewRequestSchema
>
export const MessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state") }),
  z.object({ type: z.literal("connect") }),
  z.object({ type: z.literal("disconnect") }),
  z.object({
    type: z.literal("tailor"),
    sourceResumeId: z.uuid(),
    instructions: TailorInstructionsSchema.optional(),
    identity: JobIdentitySchema,
  }),
  z.object({
    type: z.literal("retry"),
    operationId: z.uuid(),
    identity: JobIdentitySchema,
  }),
  z.object({
    type: z.literal("cancel"),
    operationId: z.uuid(),
    identity: JobIdentitySchema,
  }),
  z.object({
    type: z.literal("edit"),
    resumeId: z.uuid(),
    identity: JobIdentitySchema,
  }),
  z.object({ type: z.literal("apply"), identity: JobIdentitySchema }),
  // A section opens that part of the Autofill profile page.
  z.object({
    type: z.literal("open-app"),
    section: ProfileSectionSchema.optional(),
  }),
  z.object({ type: z.literal("autofill"), action: AutofillActionSchema }),
  AutofillPreviewRequestSchema.extend({ type: z.literal("autofill-edit") }),
])
export type Message = z.infer<typeof MessageSchema>
export const ReplySchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), snapshot: SnapshotSchema }),
  z.object({
    ok: z.literal(false),
    message: z.string(),
    code: z.enum(["capture", "auth", "unavailable", "not-found", "changed"]),
    retryAfterSeconds: z.number().optional(),
    page: PageSchema.optional(),
  }),
])
export class ExtensionError extends Error {
  constructor(
    message: string,
    readonly code: "capture" | "auth" | "unavailable" | "not-found" | "changed",
    readonly retryAfterSeconds?: number,
    readonly page?: z.infer<typeof PageSchema>
  ) {
    super(message)
  }
}
export async function send(message: Message): Promise<Snapshot> {
  const reply = ReplySchema.parse(await chrome.runtime.sendMessage(message))
  if (!reply.ok)
    throw new ExtensionError(
      reply.message,
      reply.code,
      reply.retryAfterSeconds,
      reply.page
    )
  return reply.snapshot
}

export const ResumePageMessageSchema = ResumePageInputSchema.extend({
  type: z.literal("resume-page"),
  accountId: z.string(),
})

export const ResumePreviewMessageSchema = z.object({
  type: z.literal("resume-preview"),
  accountId: z.string(),
  identity: JobIdentitySchema,
  resumeId: z.uuid(),
  operationId: z.uuid(),
})
export type PreviewRequest = Omit<
  z.infer<typeof ResumePreviewMessageSchema>,
  "type"
>
export const AutofillResumePreviewMessageSchema =
  AutofillPreviewRequestSchema.extend({
    type: z.literal("autofill-resume-preview"),
  })
export type ResumePreviewRequest = PreviewRequest | AutofillPreviewRequest

export async function sendResumePreview(input: ResumePreviewRequest) {
  const reply = z
    .discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), preview: ResumePreviewSchema }),
      ReplySchema.options[1],
    ])
    .parse(
      await chrome.runtime.sendMessage({
        ...input,
        type:
          "postingKey" in input ? "autofill-resume-preview" : "resume-preview",
      })
    )
  if (!reply.ok)
    throw new ExtensionError(reply.message, reply.code, reply.retryAfterSeconds)
  return reply.preview
}
export async function sendResumePage(accountId: string, cursor?: string) {
  const reply = z
    .discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), page: ResumePageSchema }),
      ReplySchema.options[1],
    ])
    .parse(
      await chrome.runtime.sendMessage({
        type: "resume-page",
        accountId,
        cursor,
      })
    )
  if (!reply.ok)
    throw new ExtensionError(reply.message, reply.code, reply.retryAfterSeconds)
  return reply.page
}
