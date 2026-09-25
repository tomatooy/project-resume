import { expect, it } from "vitest"
import {
  ResumeSummarySchema,
  JobLookupSchema,
  TailorRetrySchema,
} from "@workspace/resume-core/contracts"
import { contract } from "../src/contract"
it("keeps the web summary shape and explicit JSON routes", () => {
  const summary = {
    id: crypto.randomUUID(),
    title: "Resume",
    subtitle: "Draft",
    templateId: "lisbon",
    updatedAt: new Date().toISOString(),
  }
  expect(ResumeSummarySchema.parse(summary)).toEqual(summary)
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
