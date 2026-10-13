import { describe, expect, it } from "vitest"
import {
  applicationIdentity,
  sameApplication,
} from "../src/autofill/application"

describe("application identity", () => {
  it("retains an explicit job identity across manually selected steps", () => {
    expect(
      applicationIdentity("https://careers.example/apply?jobId=1234&step=1")
    ).toBe(
      applicationIdentity("https://careers.example/apply?step=2&jobId=1234")
    )
  })

  it("separates jobs, employers, origins and conflicting identities", () => {
    const key = applicationIdentity("https://careers.example/a/jobs/1234")
    expect(key).not.toBeNull()
    expect(key).not.toBe(
      applicationIdentity("https://careers.example/a/jobs/5678")
    )
    expect(key).not.toBe(
      applicationIdentity("https://careers.example/b/jobs/1234")
    )
    expect(key).not.toBe(
      applicationIdentity("https://other.example/a/jobs/1234")
    )
    expect(
      applicationIdentity("https://careers.example/apply?jobId=1234&jobId=5678")
    ).toBeNull()
  })

  it("recognizes an opaque posting id with an application suffix", () => {
    const job =
      "https://jobs.example/company/00000000-0000-4000-8000-000000000001"
    expect(applicationIdentity(job)).toBe(
      applicationIdentity(`${job}/application`)
    )
    expect(applicationIdentity(job)).not.toBeNull()
  })

  it("does not infer identity from a generic apply page or unrelated URL", () => {
    for (const url of [
      "https://careers.example/apply",
      "https://careers.example/login",
      "http://careers.example/jobs/1234",
      "not a url",
    ])
      expect(applicationIdentity(url)).toBeNull()
  })

  it("never treats unknown identities as a match", () => {
    expect(sameApplication(null, null)).toBe(false)
    expect(sameApplication("job:one", "job:one")).toBe(true)
    expect(sameApplication("job:one", "job:two")).toBe(false)
  })
})
