import { greenhouseNewFields } from "@workspace/autofill/fixtures"
import type { Resume } from "@workspace/resume-schema"
import { starter } from "@workspace/resume-schema/fixtures"
import { describe, expect, it } from "vitest"

import {
  type AutofillPage,
  type JobIdentity,
  type PlanInput,
  PlanInputSchema,
  type PlanResult,
  PlanResultSchema,
  type StartInput,
  StartInputSchema,
  StartResultSchema,
} from "../src"
import { harness, only } from "./harness"

type Harness = ReturnType<typeof harness>

const identity = {
  platform: "linkedin",
  externalJobId: "123456",
} satisfies JobIdentity

const PAGE: AutofillPage = {
  vendor: "greenhouse",
  postingKey: "greenhouse:stripe:7206421",
  url: "https://job-boards.greenhouse.io/stripe/jobs/7206421",
  company: "Stripe",
  companyWeak: false,
  title: "Software Engineer",
}

/** A posting on another vendor, for records the Stripe page does not read. */
const FIGMA: AutofillPage = {
  vendor: "ashby",
  postingKey: "ashby:figma:4a1b",
  url: "https://jobs.ashbyhq.com/figma/4a1b",
  company: "Figma",
  companyWeak: false,
  title: "Product Designer",
}

/** The fixture's "Where did you first hear about this role?" select. */
const HOW_HEARD = "question_17702872004"

const POSTING = {
  platform: null,
  externalJobId: null,
  sourceUrl: null,
  rawText: "We are hiring.",
  title: "Software Engineer",
  company: "Acme",
  location: null,
  requirements: { mustHaves: [], niceToHaves: [], keywords: [] },
}

/** Plans through the contract, so a shape the schemas refuse fails here. */
async function plan(h: Harness, over: Partial<PlanInput> = {}) {
  const input = PlanInputSchema.parse({
    page: PAGE,
    fields: greenhouseNewFields,
    resumeId: null,
    linkedin: null,
    ...over,
  })
  return PlanResultSchema.parse(await h.autofillService.plan(input))
}

async function start(h: Harness, input: StartInput) {
  const parsed = StartInputSchema.parse(input)
  return StartResultSchema.parse(await h.autofillService.start(parsed))
}

/** A resume made for a posting at `company`, linked as its origin. */
async function tailored(
  h: Harness,
  title: string,
  company: string,
  document?: Resume
) {
  const resume = await h.resumeService.create({ title, document })
  const target = await h.jobTargets.create({ ...POSTING, company })
  await h.jobTargets.link({
    resumeId: resume.id,
    jobTargetId: target.id,
    isOrigin: true,
  })
  return { resume, target }
}

describe("AutofillService.plan", () => {
  it("picks the LinkedIn job's resume first", async () => {
    const h = harness()
    const base = await h.resumeService.create({ title: "Base" })
    const found = await h.operationService.admit({
      ...identity,
      sourceResumeId: base.id,
      sourceUrl: "https://www.linkedin.com/jobs/view/123456",
      jobText: "A detailed description for an engineering position. ".repeat(8),
      idempotencyKey: crypto.randomUUID(),
    })
    if (found.kind !== "bound") throw new Error("Missing admission")
    // Newer, and tailored for the page's company.
    await tailored(h, "SWE (Stripe)", "Stripe")

    expect(await plan(h, { linkedin: identity })).toMatchObject({
      resumeId: found.resumeId,
      resumeChoice: "linkedin",
    })
    // A LinkedIn job with no tailored resume decides nothing.
    expect(
      await plan(h, { linkedin: { ...identity, externalJobId: "999999" } })
    ).toMatchObject({ resumeChoice: "company" })
  })

  it("picks the newest resume tailored for the page company", async () => {
    const h = harness()
    await tailored(h, "A", "Stripe, Inc.")
    const b = await tailored(h, "B", "stripe")
    // Newer still, but for another company or for none, and the last one
    // filled an earlier application.
    await tailored(h, "C", "Airbnb")
    const untailored = await h.resumeService.create({ title: "Untailored" })
    await start(h, { page: FIGMA, resumeId: untailored.id, useJob: false })

    expect(await plan(h)).toMatchObject({
      resumeId: b.resume.id,
      resumeChoice: "company",
    })
  })

  it("ignores a weak company for the resume choice and the job match", async () => {
    const h = harness()
    const stripe = await tailored(h, "SWE (Stripe)", "Stripe")
    const newest = await h.resumeService.create({ title: "Newest" })
    const weak = { ...PAGE, companyWeak: true }

    expect(await plan(h, { page: weak })).toMatchObject({
      resumeId: newest.id,
      resumeChoice: "recent",
    })
    expect(
      await plan(h, { page: weak, resumeId: stripe.resume.id })
    ).toMatchObject({
      job: { company: "Stripe", title: "Software Engineer" },
      jobMatch: "unknown",
    })
    expect(
      await plan(h, {
        page: { ...PAGE, company: null },
        resumeId: stripe.resume.id,
      })
    ).toMatchObject({ jobMatch: "unknown" })
  })

  it("falls back to the last autofill resume, then the most recent", async () => {
    const h = harness()
    const used = await h.resumeService.create({ title: "Used before" })
    await start(h, { page: FIGMA, resumeId: used.id, useJob: false })
    // A later record whose resume is gone since.
    const gone = await h.resumeService.create({ title: "Gone" })
    await start(h, {
      page: { ...PAGE, postingKey: "greenhouse:notion:51" },
      resumeId: gone.id,
      useJob: false,
    })
    await h.resumeService.remove(gone.id)
    await h.resumeService.create({ title: "Newest" })

    expect(await plan(h)).toMatchObject({
      resumeId: used.id,
      resumeChoice: "last",
    })

    const fresh = harness()
    await fresh.resumeService.create({ title: "Older" })
    const recent = await fresh.resumeService.create({ title: "Recent" })
    expect(await plan(fresh)).toMatchObject({
      resumeId: recent.id,
      resumeChoice: "recent",
    })

    expect(await plan(harness())).toMatchObject({
      resumeId: null,
      resumeChoice: null,
      job: null,
      jobMatch: "none",
    })
  })

  it("takes the resume of the latest autofill", async () => {
    const h = harness()
    const first = await h.resumeService.create({ title: "First" })
    const second = await h.resumeService.create({ title: "Second" })
    await start(h, { page: FIGMA, resumeId: first.id, useJob: false })
    await start(h, {
      page: { ...PAGE, postingKey: "greenhouse:notion:51" },
      resumeId: second.id,
      useJob: false,
    })

    expect(await plan(h)).toMatchObject({
      resumeId: second.id,
      resumeChoice: "last",
    })

    // Filling the first posting again makes its record the latest.
    await start(h, { page: FIGMA, resumeId: first.id, useJob: false })
    expect(await plan(h)).toMatchObject({
      resumeId: first.id,
      resumeChoice: "last",
    })
  })

  it("keeps the user's resume choice", async () => {
    const h = harness()
    const mine = await h.resumeService.create({ title: "Mine" })
    const stripe = await tailored(h, "SWE (Stripe)", "Stripe")

    expect(await plan(h, { resumeId: mine.id })).toMatchObject({
      resumeId: mine.id,
      resumeChoice: "user",
    })

    await h.resumeService.remove(mine.id)
    expect(await plan(h, { resumeId: mine.id })).toMatchObject({
      resumeId: stripe.resume.id,
      resumeChoice: "company",
    })
  })

  it("reports a job mismatch", async () => {
    const h = harness()
    const stripe = await tailored(h, "SWE (Stripe)", "Stripe")
    const base = await h.resumeService.create({ title: "Base" })
    const airbnb = {
      ...PAGE,
      postingKey: "greenhouse:airbnb:7110",
      company: "Airbnb",
    }

    expect(
      await plan(h, { page: airbnb, resumeId: stripe.resume.id })
    ).toMatchObject({
      job: { company: "Stripe", title: "Software Engineer" },
      jobMatch: "mismatch",
    })
    expect(
      await plan(h, {
        page: { ...PAGE, company: "Stripe Inc" },
        resumeId: stripe.resume.id,
      })
    ).toMatchObject({ jobMatch: "match" })
    expect(await plan(h, { resumeId: base.id })).toMatchObject({
      job: null,
      jobMatch: "none",
    })
  })

  it("returns the earlier fill and missing answers", async () => {
    const h = harness()
    const stripe = await tailored(h, "SWE (Stripe)", "Stripe")
    await start(h, { page: PAGE, resumeId: stripe.resume.id, useJob: false })
    only(h.db.autofillApplications).updatedAt = "2026-10-12T10:00:00Z"

    const result = await plan(h)

    expect(result.earlier).toEqual({
      at: "2026-10-12T10:00:00Z",
      resumeTitle: "SWE (Stripe)",
    })
    // The starter resume has an email and no phone, and the Profile is empty.
    expect(result.missing).toContainEqual({
      key: "contact.phone",
      anchor: "contact",
    })
    expect(result.missing).not.toContainEqual({
      key: "contact.email",
      anchor: "contact",
    })
    expect(
      (await plan(h, { page: { ...PAGE, postingKey: "greenhouse:stripe:1" } }))
        .earlier
    ).toBeNull()
    // The record is keyed by the vendor as well as the posting.
    expect(
      (await plan(h, { page: { ...PAGE, vendor: "ashby" } })).earlier
    ).toBeNull()

    // A deleted resume still names the earlier fill: it filled the posting then.
    await h.resumeService.remove(stripe.resume.id)
    expect((await plan(h)).earlier).toEqual({
      at: "2026-10-12T10:00:00Z",
      resumeTitle: "SWE (Stripe)",
    })
  })

  it("fills by rules from the chosen resume", async () => {
    const h = harness()
    await tailored(h, "SWE (Stripe)", "Stripe", {
      ...starter,
      basics: { ...starter.basics, name: "Ada Lovelace" },
    })

    const result = await plan(h)

    expect(result.fills).toContainEqual(
      expect.objectContaining({ fieldId: "first_name", value: "Ada" })
    )
    expect(result.classes).toHaveLength(greenhouseNewFields.length)

    // A field the page already filled is offered, not overwritten.
    const filled = await plan(h, {
      fields: greenhouseNewFields.map((field) =>
        field.id === "first_name" ? { ...field, hasValue: true } : field
      ),
    })
    expect(filled.overwrites).toContainEqual(
      expect.objectContaining({ fieldId: "first_name", value: "Ada" })
    )
    expect(filled.fills).not.toContainEqual(
      expect.objectContaining({ fieldId: "first_name" })
    )
  })

  it("tells the rules the posting came from LinkedIn", async () => {
    const h = harness()
    const heard = (result: PlanResult) =>
      result.classes.find((row) => row.fieldId === HOW_HEARD)?.route

    // How-heard answers "LinkedIn" once the select's options load.
    expect(heard(await plan(h, { linkedin: identity }))).toBe("pending")
    expect(heard(await plan(h))).toBe("ai")
  })

  it("creates no run row", async () => {
    const h = harness()
    const stripe = await tailored(h, "SWE (Stripe)", "Stripe")

    expect((await plan(h)).quota).toEqual({ remaining: 60, resetAt: null })
    expect(h.db.runs).toEqual([])

    // The quota it reports is the autofill kind's.
    await h.runService.startAutofill({
      resumeId: stripe.resume.id,
      procedure: "autofill.infer",
      model: "stub-model",
    })
    const after = await plan(h)
    expect(after.quota.remaining).toBe(59)
    expect(after.quota.resetAt).not.toBeNull()
    expect(h.db.runs).toHaveLength(1)
  })
})

describe("AutofillService.start", () => {
  it("snapshots the resume and records the application", async () => {
    const h = harness()
    const { resume } = await tailored(h, "SWE (Stripe)", "Stripe", {
      ...starter,
      basics: { ...starter.basics, name: "Ada Lovelace" },
    })

    const started = await start(h, {
      page: PAGE,
      resumeId: resume.id,
      useJob: false,
    })

    expect(await h.versionService.list(resume.id)).toEqual([
      expect.objectContaining({
        id: started.versionId,
        label: "Autofill: Stripe · Software Engineer",
        createdBy: "system",
      }),
    ])
    expect(h.db.autofillApplications).toEqual([
      expect.objectContaining({
        id: started.applicationId,
        vendor: "greenhouse",
        postingKey: "greenhouse:stripe:7206421",
        orgSlug: "stripe",
        url: PAGE.url,
        company: "Stripe",
        title: "Software Engineer",
        resumeId: resume.id,
        resumeVersionId: started.versionId,
      }),
    ])
    expect(started.fileName).toBe("SWE(Stripe).pdf")
    const head = await h.resumeService.get(resume.id)
    expect(started.document).toEqual({
      data: head.data,
      templateId: head.templateId,
      templateOptions: head.templateOptions,
    })

    const again = await start(h, {
      page: PAGE,
      resumeId: resume.id,
      useJob: false,
    })
    expect(await h.versionService.list(resume.id)).toHaveLength(1)
    expect(again.applicationId).toBe(started.applicationId)
    expect(again.versionId).toBe(started.versionId)
    expect(h.db.autofillApplications).toHaveLength(1)
  })

  it("labels the snapshot with what the page names", async () => {
    const h = harness()
    const titled = await h.resumeService.create({ title: "A" })
    const bare = await h.resumeService.create({ title: "B" })

    await start(h, {
      page: { ...PAGE, title: null },
      resumeId: titled.id,
      useJob: false,
    })
    await start(h, {
      page: { ...PAGE, company: null, title: null },
      resumeId: bare.id,
      useJob: false,
    })

    expect(only(await h.versionService.list(titled.id)).label).toBe(
      "Autofill: Stripe"
    )
    expect(only(await h.versionService.list(bare.id)).label).toBe(
      "Autofill: application"
    )
  })

  it("stores no job target unless the job description is used", async () => {
    const h = harness()
    const { resume, target } = await tailored(h, "SWE (Stripe)", "Stripe")

    await start(h, { page: PAGE, resumeId: resume.id, useJob: false })
    expect(only(h.db.autofillApplications).jobTargetId).toBeNull()

    await start(h, { page: PAGE, resumeId: resume.id, useJob: true })
    expect(only(h.db.autofillApplications).jobTargetId).toBe(target.id)
  })

  it("refuses a deleted resume without recording anything", async () => {
    const h = harness()
    const gone = await h.resumeService.create({ title: "Gone" })
    await h.resumeService.remove(gone.id)

    await expect(
      h.autofillService.start({ page: PAGE, resumeId: gone.id, useJob: false })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    expect(h.db.autofillApplications).toEqual([])
  })
})
