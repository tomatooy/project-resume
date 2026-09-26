import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { ApplyLinkCaptureSchema } from "../src/lib/messages"

const sourceUrl = document.location.href
const target =
  "https://careers-compsych.icims.com/jobs/2223/software-engineer/job?mode=apply&iis=LinkedIn"
const safeLink =
  "https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fcareers-compsych%2Eicims%2Ecom%2Fjobs%2F2223%2Fsoftware-engineer%2Fjob%3Fmode%3Dapply%26iis%3DLinkedIn&urlhash=DFjL&isSdui=true"
const apply = (href = safeLink) =>
  `<a aria-label="Apply on company website" href="${href}">Apply</a>`
const listener = vi.fn<typeof chrome.runtime.onMessage.addListener>()
beforeAll(async () => {
  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension",
      getURL: (path: string) => `chrome-extension://extension/${path}`,
      sendMessage: vi.fn(async () => ({ visible: true, position: 0.25 })),
      onMessage: { addListener: listener },
    },
  })
  await import("../src/content/widget-host")
})
afterAll(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})
function capture(html: string) {
  document.body.innerHTML = html
  const respond = vi.fn()
  listener.mock.calls[0]?.[0](
    { type: "capture-apply-link", jobId: "4458686457" },
    { id: "extension" },
    respond
  )
  return ApplyLinkCaptureSchema.parse(respond.mock.calls[0]?.[0])
}

describe("application link capture", () => {
  it("decodes the supplied logged-in Apply link and deduplicates repeated buttons", () => {
    expect(capture(apply() + apply())).toEqual({ sourceUrl, applyUrl: target })
  })
  it("preserves destination parameters and reads public offsite tracking", () => {
    expect(
      capture(
        '<a href="https://jobs.example.test/123?jobId=3&amp;return=%2Fapply%3Fa%3D1" data-tracking-control-name="public_jobs_apply-link-offsite">申请</a>'
      ).applyUrl
    ).toBe("https://jobs.example.test/123?jobId=3&return=%2Fapply%3Fa%3D1")
  })
  it("prefers a company application link to a generic Apply link", () => {
    expect(
      capture(`<a href="https://jobs.example.test/other">Apply</a>${apply()}`)
        .applyUrl
    ).toBe(target)
  })
  it("reads a generic Apply anchor with an accessible label", () => {
    expect(
      capture(`<a href="${target}" aria-label="Apply">Apply</a>`).applyUrl
    ).toBe(target)
  })
  it("ignores hidden and disabled buttons and anchors scoped to another job", () => {
    expect(
      capture(
        `<div hidden>${apply("https://jobs.example.test/hidden")}</div><div style="display:none">${apply("https://jobs.example.test/stale")}</div><div data-job-id="123456">${apply("https://jobs.example.test/other")}</div>${apply()}`
      ).applyUrl
    ).toBe(target)
  })
  it("returns no target when visible application buttons disagree", () => {
    expect(
      capture(apply() + apply("https://jobs.example.test/other")).applyUrl
    ).toBeNull()
  })
  it.each([
    '<button data-modal="job-details-topcard-apply-modal">Apply</button>',
    "<button>Easy Apply</button>",
    '<a href="https://www.linkedin.com/jobs/view/123456/">Apply</a>',
    '<a href="https://company.example.test">Company website</a>',
    `<a href="${target}" aria-disabled="true">Apply</a>`,
    `<div aria-hidden="true">${apply()}</div>`,
    `<div inert>${apply()}</div>`,
    `<div style="visibility:hidden">${apply()}</div>`,
    `<script>${apply()}</script>`,
    `<template>${apply()}</template>`,
    apply("javascript:alert(1)"),
    apply("data:text/html,hello"),
    apply("https://user:password@example.test/apply"),
    apply("/safety/go/?url=not-a-url"),
    apply(
      "/safety/go/?url=https%3A%2F%2Fexample.test&url=https%3A%2F%2Fother.test"
    ),
  ])("does not infer an application from %s", (html) => {
    expect(capture(html).applyUrl).toBeNull()
  })
})
