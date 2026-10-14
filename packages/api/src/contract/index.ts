import {
  AutofillProfileSchema,
  ProfileUpdateSchema,
  PrepareSourcesInputSchema,
  SourcePreparationSchema,
  PdfDocumentInputSchema,
  PdfDocumentSchema,
  ScopedAnswerSchema,
  SaveScopedAnswerSchema,
  DeleteScopedAnswerSchema,
} from "@workspace/resume-core/contracts"
import { oc } from "@orpc/contract"
import {
  JobIdentitySchema,
  JobLookupSchema,
  ResumeSummarySchema,
  ResumePageInputSchema,
  ResumePageSchema,
  TailorAdmissionSchema,
  TailorRetrySchema,
  MIN_JOB_CHARS,
  MAX_JOB_CHARS,
} from "@workspace/resume-core/contracts"
import { z } from "zod"

const recoveryData = z
  .object({
    reasonCode: z
      .enum([
        "source_changed",
        "invalid_snapshot",
        "profile_conflict",
        "autofill_quota",
        "policy_disabled",
      ])
      .optional(),
    retryAfterSeconds: z.number().optional(),
  })
  .optional()
export const apiErrors = {
  UNAUTHENTICATED: { status: 401, data: recoveryData },
  NOT_FOUND: { status: 404, data: recoveryData },
  CONFLICT: { status: 409, data: recoveryData },
  VALIDATION: { status: 400, data: recoveryData },
  RATE_LIMITED: {
    status: 429,
    data: recoveryData,
  },
  INTERNAL: { status: 500, data: recoveryData },
}
const base = oc.errors(apiErrors)
export const JobPostingSchema = z.object({
  url: z.url(),
  text: z.string().min(MIN_JOB_CHARS).max(MAX_JOB_CHARS),
})
export const contract = {
  autofillProfile: {
    get: base
      .route({ method: "GET", path: "/autofill-profile" })
      .input(z.strictObject({}))
      .output(AutofillProfileSchema),
    update: base
      .route({ method: "POST", path: "/autofill-profile" })
      .input(ProfileUpdateSchema)
      .output(AutofillProfileSchema),
  },
  autofill: {
    document: base
      .route({ method: "POST", path: "/autofill/document" })
      .input(PdfDocumentInputSchema)
      .output(PdfDocumentSchema),
    prepare: base
      .route({ method: "POST", path: "/autofill/prepare" })
      .input(PrepareSourcesInputSchema)
      .output(SourcePreparationSchema),
  },
  autofillAnswers: {
    list: base
      .route({ method: "GET", path: "/autofill/answers" })
      .input(z.strictObject({}))
      .output(z.array(ScopedAnswerSchema).max(500)),
    save: base
      .route({ method: "POST", path: "/autofill/answers" })
      .input(SaveScopedAnswerSchema)
      .output(ScopedAnswerSchema),
    remove: base
      .route({ method: "POST", path: "/autofill/answers/remove" })
      .input(DeleteScopedAnswerSchema)
      .output(z.void()),
  },
  resumes: {
    page: base
      .route({ method: "GET", path: "/resumes/page" })
      .input(ResumePageInputSchema)
      .output(ResumePageSchema),
    summary: base
      .route({ method: "GET", path: "/resumes/{id}/summary" })
      .input(z.object({ id: z.uuid() }))
      .output(ResumeSummarySchema),
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
