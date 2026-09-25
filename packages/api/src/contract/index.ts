import { oc } from "@orpc/contract"
import {
  JobIdentitySchema,
  JobLookupSchema,
  ResumeSummarySchema,
  TailorAdmissionSchema,
  TailorRetrySchema,
  MIN_JOB_CHARS,
  MAX_JOB_CHARS,
} from "@workspace/resume-core/contracts"
import { z } from "zod"

export const apiErrors = {
  UNAUTHENTICATED: { status: 401 },
  NOT_FOUND: { status: 404 },
  CONFLICT: { status: 409 },
  VALIDATION: { status: 400 },
  RATE_LIMITED: {
    status: 429,
    data: z.object({ retryAfterSeconds: z.number().optional() }),
  },
  INTERNAL: { status: 500 },
}
const base = oc.errors(apiErrors)
export const JobPostingSchema = z.object({
  url: z.url(),
  text: z.string().min(MIN_JOB_CHARS).max(MAX_JOB_CHARS),
})
export const contract = {
  resumes: {
    list: base
      .route({ method: "GET", path: "/resumes" })
      .input(z.object({}))
      .output(z.array(ResumeSummarySchema)),
  },
  jobs: {
    fetchPosting: base
      .route({
        method: "POST",
        path: "/jobs/{platform}/{externalJobId}/posting",
      })
      .input(JobIdentitySchema)
      .output(JobPostingSchema),
    lookup: base
      .route({ method: "GET", path: "/jobs/{platform}/{externalJobId}" })
      .input(JobIdentitySchema)
      .output(JobLookupSchema),
    tailor: base
      .route({
        method: "POST",
        path: "/jobs/{platform}/{externalJobId}/tailor",
        successStatus: 202,
      })
      .input(TailorAdmissionSchema)
      .output(JobLookupSchema),
    retry: base
      .route({
        method: "POST",
        path: "/jobs/{platform}/{externalJobId}/retry",
        successStatus: 202,
      })
      .input(TailorRetrySchema)
      .output(JobLookupSchema),
  },
  operations: {
    cancel: base
      .route({ method: "POST", path: "/operations/{operationId}/cancel" })
      .input(z.object({ operationId: z.uuid() }))
      .output(JobLookupSchema),
  },
}
