// @vitest-environment node
import { expect, it } from "vitest"
import {
  SUPPORTED_MATCHES,
  atsVendor,
  categoryOf,
  classifyPage,
} from "../src/lib/pages"

/** Whether a manifest pattern lets the content script run on the URL. */
function covered(input: string) {
  const { hostname } = new URL(input)
  return SUPPORTED_MATCHES.some((pattern) => {
    const host = pattern.slice("https://".length, -"/*".length)
    return host.startsWith("*.")
      ? hostname === host.slice(2) || hostname.endsWith(host.slice(1))
      : hostname === host
  })
}

it.each([
  ["https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x/apply", "workday"],
  ["https://wd1.myworkdaysite.com/recruiting/acme/careers", "workday"],
  ["https://boards.greenhouse.io/acme/jobs/1", "greenhouse"],
  ["https://job-boards.eu.greenhouse.io/acme/jobs/1", "greenhouse"],
  ["https://jobs.lever.co/acme/1/apply", "lever"],
  ["https://jobs.eu.lever.co/acme/1", "lever"],
  ["https://jobs.ashbyhq.com/acme/1/application", "ashby"],
  ["https://jobs.smartrecruiters.com/Acme/1", "smartrecruiters"],
  ["https://careers-acme.icims.com/jobs/1/job", "icims"],
])("recognizes %s as a %s application", (url, vendor) => {
  expect(atsVendor(url)).toBe(vendor)
  expect(classifyPage(url)).toEqual({ kind: "ats", vendor })
  expect(covered(url)).toBe(true)
})

it.each([
  "https://myworkdayjobs.com/acme",
  "https://evilmyworkdayjobs.com/acme",
  "https://www.icims.com/",
  "https://greenhouse.io/",
  "https://boards.greenhouse.io.evil.test/acme",
  "http://boards.greenhouse.io/acme/jobs/1",
  "https://boards.greenhouse.io:8443/acme/jobs/1",
  "https://user:secret@jobs.lever.co/acme",
  "not a url",
])("does not treat %s as an application", (url) => {
  expect(atsVendor(url)).toBeNull()
  expect(categoryOf(classifyPage(url))).toBe("unsupported")
})

it("keeps LinkedIn job pages, and only those, in the job category", () => {
  expect(
    categoryOf(classifyPage("https://www.linkedin.com/jobs/view/123456/"))
  ).toBe("job")
  expect(
    categoryOf(
      classifyPage("https://www.linkedin.com/jobs/search-results/?keywords=x")
    )
  ).toBe("job")
  expect(categoryOf(classifyPage("https://www.linkedin.com/feed/"))).toBe(
    "unsupported"
  )
  expect(covered("https://www.linkedin.com/feed/")).toBe(true)
})
