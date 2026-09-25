import {
  ResumePageSchema,
  ResumePageInputSchema,
} from "@workspace/resume-core/contracts"
import { z } from "zod"
import {
  JobIdentitySchema,
  JobLookupSchema,
  ResumeSummarySchema,
} from "@workspace/resume-core/contracts"

export const PageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unsupported") }),
  z.object({ kind: z.literal("select-job") }),
  z.object({
    kind: z.literal("job"),
    identity: JobIdentitySchema,
    sourceUrl: z.string(),
  }),
])
export const SnapshotSchema = z.object({
  page: PageSchema,
  account: z.object({ id: z.string(), email: z.string() }).nullable(),
  lookup: JobLookupSchema.nullable(),
  resumes: z.array(ResumeSummarySchema),
  nextResumeCursor: z.string().nullable().default(null),
  lastBaseId: z.string().nullable(),
})
export type Snapshot = z.infer<typeof SnapshotSchema>
export const MessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state") }),
  z.object({ type: z.literal("connect") }),
  z.object({ type: z.literal("disconnect") }),
  z.object({
    type: z.literal("tailor"),
    sourceResumeId: z.uuid(),
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
  z.object({ type: z.literal("open-app") }),
])
export type Message = z.infer<typeof MessageSchema>
export const ReplySchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), snapshot: SnapshotSchema }),
  z.object({
    ok: z.literal(false),
    message: z.string(),
    code: z.enum(["capture", "auth", "unavailable"]),
    retryAfterSeconds: z.number().optional(),
  }),
])
export class ExtensionError extends Error {
  constructor(
    message: string,
    readonly code: "capture" | "auth" | "unavailable",
    readonly retryAfterSeconds?: number
  ) {
    super(message)
  }
}
export async function send(message: Message): Promise<Snapshot> {
  const reply = ReplySchema.parse(await chrome.runtime.sendMessage(message))
  if (!reply.ok)
    throw new ExtensionError(reply.message, reply.code, reply.retryAfterSeconds)
  return reply.snapshot
}

export const ResumePageMessageSchema = ResumePageInputSchema.extend({
  type: z.literal("resume-page"),
  accountId: z.string(),
})
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
