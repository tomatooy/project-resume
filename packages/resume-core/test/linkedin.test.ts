import { describe, expect, it } from "vitest"

import { normalizeLinkedInJobUrl } from "../src/domain/linkedin"

const CANONICAL = "https://www.linkedin.com/jobs/view/4456278957/"

describe("normalizeLinkedInJobUrl", () => {
  it("keeps a canonical posting url as it is", () => {
    expect(normalizeLinkedInJobUrl(CANONICAL)).toBe(CANONICAL)
  })

  it("strips the slug a search result carries", () => {
    expect(
      normalizeLinkedInJobUrl(
        "https://www.linkedin.com/jobs/view/senior-engineer-at-acme-4456278957"
      )
    ).toBe(CANONICAL)
  })

  it("takes the id out of a collections url's query", () => {
    expect(
      normalizeLinkedInJobUrl(
        "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4456278957&discover=true"
      )
    ).toBe(CANONICAL)
  })

  it("accepts the email and mobile hosts and paths", () => {
    expect(
      normalizeLinkedInJobUrl(
        "https://www.linkedin.com/comm/jobs/view/4456278957"
      )
    ).toBe(CANONICAL)
    expect(
      normalizeLinkedInJobUrl("https://uk.linkedin.com/jobs/view/4456278957/")
    ).toBe(CANONICAL)
  })

  it("adds a missing scheme rather than rejecting", () => {
    expect(normalizeLinkedInJobUrl("linkedin.com/jobs/view/4456278957")).toBe(
      CANONICAL
    )
  })

  it("rejects other hosts, other linkedin pages, and nonsense", () => {
    expect(
      normalizeLinkedInJobUrl("https://www.indeed.com/viewjob?jk=4456278957")
    ).toBeNull()
    expect(
      normalizeLinkedInJobUrl("https://www.linkedin.com/in/ada-lovelace/")
    ).toBeNull()
    expect(normalizeLinkedInJobUrl("not a url")).toBeNull()
    expect(normalizeLinkedInJobUrl("")).toBeNull()
  })
})
