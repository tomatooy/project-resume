import { describe, expect, it } from "vitest"

import { harness } from "./harness"

describe("TailorService.fetchPosting", () => {
  it("normalises the url before fetching and returns the text", async () => {
    const h = harness()
    // The stub returns what the adapter would have produced: plain text.
    // Stripping HTML is `WorkerJobFetcher`'s job, not the service's.
    h.jobFetcher.text = `We are hiring a Senior Engineer. ${"detail ".repeat(60)}`

    const result = await h.tailorService.fetchPosting(
      "https://www.linkedin.com/jobs/view/senior-engineer-at-acme-4456278957"
    )

    expect(h.jobFetcher.calls).toEqual([
      "https://www.linkedin.com/jobs/view/4456278957/",
    ])
    expect(result.url).toBe("https://www.linkedin.com/jobs/view/4456278957/")
    expect(result.text).toContain("We are hiring")
  })

  it("rejects a non-LinkedIn link without fetching anything", async () => {
    const h = harness()

    await expect(
      h.tailorService.fetchPosting("https://www.indeed.com/viewjob?jk=1")
    ).rejects.toMatchObject({ code: "VALIDATION" })
    expect(h.jobFetcher.calls).toHaveLength(0)
  })

  it("treats a sign-in wall as unreadable rather than as a posting", async () => {
    const h = harness()
    h.jobFetcher.text = "Sign in to view this job"

    await expect(
      h.tailorService.fetchPosting(
        "https://www.linkedin.com/jobs/view/4456278957/"
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})
