import { expect, it } from "vitest"
import { isAutofillApplicationUrl } from "../src/autofill/sites"

it.each([
  "https://boards.greenhouse.io/example/jobs/123",
  "https://job-boards.greenhouse.io/example/jobs/123",
  "https://job-boards.eu.greenhouse.io/example/jobs/123",
  "https://jobs.lever.co/example/123/apply",
  "https://jobs.eu.lever.co/example/123/apply",
  "https://jobs.ashbyhq.com/example/123/application",
  "https://example.wd5.myworkdayjobs.com/en-US/External/job/123",
  "https://careers-example.icims.com/jobs/123/job",
  "https://careers.icims.com/jobs/search",
  "https://jobs-example.icims.com/jobs/123/job",
  "https://jobs.smartrecruiters.com/Example/123",
  "https://careers.smartrecruiters.com/Example",
  "https://apply.workable.com/example/j/123/apply",
  "https://jobs.jobvite.com/example/job/123/apply",
])("recognizes the application entry point %s", (url) => {
  expect(isAutofillApplicationUrl(url)).toBe(true)
})
it.each([
  "https://jobs.lever.co.attacker.test/apply",
  "https://fakejobs.lever.co/apply",
  "https://notmyworkdayjobs.com/apply",
  "https://example.myworkdayjobs.com.attacker.test/apply",
  "https://careers-example.icims.com.attacker.test/jobs",
  "https://community.icims.com/",
  "https://login.icims.com/",
  "https://www.greenhouse.io/",
  "https://app.ashbyhq.com/",
  "https://www.linkedin.com/jobs/view/123456",
  "https://jobs.example.test/",
  "https://attacker.test/?url=https://jobs.lever.co/",
  "https://jobs.lever.co@attacker.test/",
  "https://user:password@jobs.lever.co/",
  "https://jobs.lever.co:8443/",
  "http://jobs.lever.co/example/123",
  "invalid",
])("does not auto-open on unrelated or misleading URLs: %s", (url) => {
  expect(isAutofillApplicationUrl(url)).toBe(false)
})
