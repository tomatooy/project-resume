import { describe, expect, it } from "vitest"
import {
  linkedinExtensionPage,
  JobIdentitySchema,
  NullableJobIdentitySchema,
  jobIdentityFromUrl,
  TailorAdmissionSchema,
} from "../src/contracts"

describe("extension eligibility", () => {
  it.each([
    "https://www.linkedin.com/jobs/view/123456/",
    "https://www.linkedin.com/jobs/view/engineer-at-acme-123456?tracking=x",
    "https://www.linkedin.com/jobs/search-results/?foo=1&currentJobId=123456",
    "https://www.linkedin.com/jobs/search-results/?currentJobId=123456&foo=2",
  ])("resolves one identity: %s", (url) => {
    expect(linkedinExtensionPage(url)).toMatchObject({
      kind: "job",
      identity: { platform: "linkedin", externalJobId: "123456" },
    })
    expect(jobIdentityFromUrl(url)).toEqual({
      platform: "linkedin",
      externalJobId: "123456",
    })
  })
  it.each([
    "http://www.linkedin.com/jobs/view/123456",
    "https://linkedin.com/jobs/view/123456",
    "https://www.linkedin.com.evil.test/jobs/view/123456",
    "https://www.linkedin.com/jobs/collections/?currentJobId=123456",
    "https://www.linkedin.com/jobs/view/12345",
    "https://www.linkedin.com/jobs/view/123456?currentJobId=654321",
    "https://www.linkedin.com/jobs/view/123456?currentJobId=123456&currentJobId=123456",
    "https://www.linkedin.com/jobs/search-results/",
    "https://www.linkedin.com/jobs/view/123456/extra",
    "https://user@www.linkedin.com/jobs/view/123456",
  ])("refuses unsupported URLs: %s", (url) =>
    expect(linkedinExtensionPage(url).kind).toBe("unsupported")
  )
  it.each(["?keywords=engineer", "?currentJobId=invalid", "?currentJobId="])(
    "distinguishes no selection: %s",
    (query) =>
      expect(
        linkedinExtensionPage(
          `https://www.linkedin.com/jobs/search-results/${query}`
        ).kind
      ).toBe("select-job")
  )
  it("rejects incomplete and unsupported identities", () => {
    expect(
      NullableJobIdentitySchema.safeParse({
        platform: null,
        externalJobId: null,
      }).success
    ).toBe(true)
    expect(
      NullableJobIdentitySchema.safeParse({
        platform: "linkedin",
        externalJobId: null,
      }).success
    ).toBe(false)
    expect(
      JobIdentitySchema.safeParse({
        platform: "other",
        externalJobId: "123456",
      }).success
    ).toBe(false)
  })
  it("rejects a route/source mismatch", () => {
    expect(
      TailorAdmissionSchema.safeParse({
        platform: "linkedin",
        externalJobId: "123456",
        sourceResumeId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        jobText: "Job description ".repeat(20),
        sourceUrl: "https://www.linkedin.com/jobs/view/654321",
      }).success
    ).toBe(false)
  })
})
