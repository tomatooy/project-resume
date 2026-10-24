import { expect, it } from "vitest"
import {
  ResumeSummarySchema,
  JobLookupSchema,
  TailorRetrySchema,
  TailorAdmissionSchema,
  MAX_TAILOR_INSTRUCTIONS_CHARS,
} from "@workspace/resume-core/contracts"
import { contract } from "../src/contract"
it("accepts optional tailoring instructions and rejects oversized instructions", () => {
  const input = {
    platform: "linkedin",
    externalJobId: "123456",
    sourceResumeId: crypto.randomUUID(),
    sourceUrl: "https://www.linkedin.com/jobs/view/123456/",
    jobText: "An engineering posting with enough detail to tailor. ".repeat(8),
    idempotencyKey: crypto.randomUUID(),
  }
  expect(TailorAdmissionSchema.safeParse(input).success).toBe(true)
  expect(
    TailorAdmissionSchema.parse({ ...input, instructions: "No summary." })
      .instructions
  ).toBe("No summary.")
  expect(
    TailorAdmissionSchema.safeParse({
      ...input,
      instructions: "x".repeat(MAX_TAILOR_INSTRUCTIONS_CHARS + 1),
    }).success
  ).toBe(false)
})

it("keeps the web summary shape and explicit JSON routes", () => {
  const summary = {
    id: crypto.randomUUID(),
    title: "Resume",
    subtitle: "Draft",
    templateId: "lisbon",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  // A summary sent before `job` existed still parses, with no origin job.
  expect(ResumeSummarySchema.parse(summary)).toEqual({ ...summary, job: null })
  expect(contract.resumes.list["~orpc"].route).toMatchObject({
    method: "GET",
    path: "/resumes",
  })
  expect(contract.jobs.tailor["~orpc"].route.successStatus).toBe(202)
})
it("never treats unreadable status as an empty result", () => {
  expect(JobLookupSchema.safeParse({}).success).toBe(false)
  expect(JobLookupSchema.parse({ kind: "none" })).toEqual({ kind: "none" })
  expect(
    TailorRetrySchema.safeParse({
      platform: "linkedin",
      externalJobId: "123456",
      idempotencyKey: crypto.randomUUID(),
    }).success
  ).toBe(false)
})
