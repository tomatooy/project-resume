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
it("exposes the bounded autofill routes through the authenticated contract", () => {
  expect(contract.autofillProfile.get["~orpc"].route).toMatchObject({
    method: "GET",
    path: "/autofill-profile",
  })
  expect(contract.autofillProfile.update["~orpc"].route).toMatchObject({
    method: "POST",
    path: "/autofill-profile",
  })
  // The plan, draft and policy operations were deleted with the retired engine.
  for (const kind of ["prepare", "document"] as const)
    expect(contract.autofill[kind]["~orpc"].route).toMatchObject({
      method: "POST",
      path: `/autofill/${kind}`,
    })
})
