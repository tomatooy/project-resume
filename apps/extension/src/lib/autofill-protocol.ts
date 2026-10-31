import {
  type Fill,
  FieldDescriptorSchema,
  FieldsSchema,
  LIMITS,
  OptionSchema,
} from "@workspace/autofill/fields"
import { z } from "zod"

/*
 * Messages between the autofill content script and the service worker. Only
 * the service worker loads this module at runtime; the content script imports
 * its types, so the content bundle stays free of zod.
 */

const FieldIdSchema = FieldDescriptorSchema.shape.id

export const PageInfoSchema = z.object({
  company: z.string().min(1).max(200).nullable(),
  companyWeak: z.boolean(),
  title: z.string().min(1).max(300).nullable(),
})

export const WriteOutcomeSchema = z.enum([
  "written",
  "skipped",
  "unmatched",
  "failed",
])

/** Content script to service worker. Untrusted: page text shapes it. */
export const ScanSchema = z.object({
  type: z.literal("autofill-scan"),
  url: z.url().max(2000),
  postingKey: z.string().min(1).max(300).nullable(),
  page: PageInfoSchema,
  form: z.boolean(),
  // The service worker navigates the tab to it.
  formLink: z
    .url({ protocol: /^https$/ })
    .max(2000)
    .nullable(),
  fields: FieldsSchema,
  revision: z.number().int().nonnegative().optional(),
})

export const ContentMessageSchema = z.discriminatedUnion("type", [
  ScanSchema,
  z.object({
    type: z.literal("autofill-resolve-search"),
    requestId: z.uuid(),
    fieldId: FieldIdSchema,
    options: z.array(OptionSchema).min(1).max(20),
  }),
  z.object({
    type: z.literal("autofill-owned"),
    fieldIds: z.array(FieldIdSchema).max(LIMITS.fields),
  }),
  z.object({
    type: z.literal("autofill-draft"),
    fieldId: FieldIdSchema,
    instruction: z.string().max(LIMITS.instruction).optional(),
  }),
  z.object({ type: z.literal("autofill-inserted"), fieldId: FieldIdSchema }),
])
export type ContentMessage = z.infer<typeof ContentMessageSchema>

/**
 * Service worker to content script. The content script trusts these by
 * sender id, so they are typed here but never parsed.
 */
type WorkerCommand =
  | { type: "autofill-ping" }
  | { type: "autofill-rescan" }
  | { type: "autofill-open-form" }
  | { type: "autofill-prepare"; retry: boolean }
  | {
      type: "autofill-write"
      fills: Fill[]
      force: string[]
      identities: Record<string, string>
      requestId?: string
    }
  | {
      type: "autofill-attach"
      fieldId: string
      fileName: string
      base64: string
      previous: string | null
    }
  | { type: "autofill-clear"; fieldId: string }
  | { type: "autofill-focus"; fieldId: string }
  | { type: "autofill-overlay"; fieldIds: string[]; disabled: string | null }
  | {
      type: "autofill-draft-result"
      fieldId: string
      text: string | null
      error: string | null
    }

export type WorkerMessage = WorkerCommand & {
  /** Guards navigation between postings within the same document. */
  postingKey?: string | null
}

const OkSchema = z.object({ ok: z.boolean() })

/** The content script's reply to each message, parsed by the service worker. */
export const WorkerReplySchemas = {
  "autofill-ping": z.object({
    alive: z.literal(true),
    postingKey: z.string().min(1).max(300).nullable(),
  }),
  "autofill-rescan": z.object({ ok: z.literal(true) }),
  "autofill-open-form": OkSchema,
  "autofill-prepare": z.object({
    scan: ScanSchema.nullable(),
    outcomes: z.record(
      FieldIdSchema,
      z.enum([
        "cached",
        "ready",
        "search",
        "unavailable",
        "skipped",
        "interrupted",
      ])
    ),
  }),
  "autofill-write": z.object({
    results: z.record(FieldIdSchema, WriteOutcomeSchema),
  }),
  "autofill-attach": z.object({
    result: z.enum(["attached", "skipped", "failed"]),
  }),
  "autofill-clear": OkSchema,
  "autofill-focus": OkSchema,
  "autofill-overlay": OkSchema,
  "autofill-draft-result": OkSchema,
} satisfies Record<WorkerMessage["type"], z.ZodType>

export type WorkerReply<T extends WorkerMessage["type"]> = z.infer<
  (typeof WorkerReplySchemas)[T]
>
