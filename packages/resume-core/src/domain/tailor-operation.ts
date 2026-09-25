import { z } from "zod"
import { JobIdentitySchema } from "./job-identity"
import { MAX_JOB_CHARS, MIN_JOB_CHARS } from "./job-target"
import { matchesJobUrl } from "./linkedin-extension"

export const ATTEMPT_MS = 5 * 60_000
export const CREDENTIAL_MARGIN_MS = 60_000
export const OperationStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
])
export const OperationErrorSchema = z.enum([
  "expired",
  "conflict",
  "deleted",
  "generation_failed",
  "dispatch_failed",
  "unverified_legacy",
])
export const TailorOperationSchema = z.object({
  legacy: z.boolean().default(false),
  id: z.uuid(),
  bindingId: z.uuid(),
  resumeId: z.uuid(),
  jobTargetId: z.uuid(),
  attempt: z.number().int().positive(),
  status: OperationStatusSchema,
  expectedRevision: z.number().int(),
  inputVersionId: z.uuid(),
  idempotencyKey: z.uuid(),
  deadline: z.iso.datetime({ offset: true }),
  dispatchAfter: z.iso.datetime({ offset: true }).nullable().optional(),
  errorClass: OperationErrorSchema.nullable(),
  agentRunId: z.uuid().nullable(),
})
export type TailorOperation = z.infer<typeof TailorOperationSchema>
export type OperationError = z.infer<typeof OperationErrorSchema>
export const JobLookupSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("bound"),
    identity: JobIdentitySchema,
    resumeId: z.uuid(),
    operation: TailorOperationSchema,
    canRetry: z.boolean(),
    canCancel: z.boolean(),
  }),
])
export type JobLookup = z.infer<typeof JobLookupSchema>
export const TailorAdmissionSchema = JobIdentitySchema.extend({
  sourceResumeId: z.uuid(),
  jobText: z.string().trim().min(MIN_JOB_CHARS).max(MAX_JOB_CHARS),
  sourceUrl: z.url().max(2000),
  idempotencyKey: z.uuid(),
}).refine((input) => matchesJobUrl(input, input.sourceUrl), {
  message: "Job identity does not match the selected page",
})
export type TailorAdmission = z.infer<typeof TailorAdmissionSchema>
export const TailorRetrySchema = JobIdentitySchema.extend({
  expectedOperationId: z.uuid(),
  idempotencyKey: z.uuid(),
})
export type TailorRetry = z.infer<typeof TailorRetrySchema>
export function isActive(operation: TailorOperation): boolean {
  return operation.status === "queued" || operation.status === "running"
}
export function boundJob(
  identity: z.infer<typeof JobIdentitySchema>,
  operation: TailorOperation
): JobLookup {
  return {
    kind: "bound",
    identity,
    resumeId: operation.resumeId,
    operation,
    canRetry: operation.status === "failed" || operation.status === "cancelled",
    canCancel: isActive(operation),
  }
}
