import type { ParsedResume } from "@workspace/resume-schema"
import { describe, expect, it } from "vitest"

import { harness } from "./harness"

const POSTING = "x".repeat(400)

const PARSED_JOB = {
  title: "Senior Engineer",
  company: "Acme",
  mustHaves: ["TypeScript"],
  niceToHaves: [],
  keywords: ["React"],
}

const TAILORED: ParsedResume = {
  basics: { name: "Ada Lovelace", summary: "Engineer who ships TypeScript." },
  sections: [
    {
      type: "experience",
      title: "Experience",
      items: [
        {
          company: "Babbage & Co",
          role: "Analyst",
          start: "1842",
          end: "1843",
          bullets: ["Shipped the first program, in TypeScript terms."],
        },
      ],
    },
  ],
}

async function seed(h: ReturnType<typeof harness>) {
  return h.resumeService.create({ title: "Ada Lovelace" })
}

describe("TailorService", () => {
  it("names the resume after the posting and writes exactly one version", async () => {
    const h = harness()
    const base = await seed(h)
    h.jobParser.result = PARSED_JOB
    h.resumeTailor.result = TAILORED

    const result = await h.tailorService.tailorFromJob({
      sourceResumeId: base.id,
      jobText: POSTING,
    })

    expect(result.tailored).toBe(true)
    expect(result.resume.title).toBe("Acme - Senior Engineer")
    expect(result.resume.subtitle).toBe("Tailored for Acme")

    const versions = await h.versionService.list(result.resume.id)
    expect(versions.map((v) => [v.label, v.createdBy])).toEqual([
      ["Tailored for Senior Engineer at Acme", "system"],
    ])
  })

  it("stores the posting and links it to the new resume as its origin", async () => {
    const h = harness()
    const base = await seed(h)
    h.jobParser.result = PARSED_JOB

    const result = await h.tailorService.tailorFromJob({
      sourceResumeId: base.id,
      jobText: POSTING,
      sourceUrl: "https://www.linkedin.com/jobs/view/4456278957/",
    })

    const target = await h.jobTargets.findById(result.jobTargetId)
    expect(target?.company).toBe("Acme")
    expect(target?.rawText).toBe(POSTING)
    expect(await h.jobTargets.listForResume(result.resume.id)).toEqual([target])
  })

  it("keeps the plain duplicate when the writing call fails", async () => {
    const h = harness()
    const base = await seed(h)
    h.jobParser.result = PARSED_JOB
    h.resumeTailor.failWith = new Error("provider down")

    const result = await h.tailorService.tailorFromJob({
      sourceResumeId: base.id,
      jobText: POSTING,
    })

    expect(result.tailored).toBe(false)
    expect(result.resume.subtitle).toBe("Draft · not tailored")

    const record = await h.resumeService.get(result.resume.id)
    const original = await h.resumeService.get(base.id)
    expect(record.data.basics.name).toBe(original.data.basics.name)

    const versions = await h.versionService.list(result.resume.id)
    expect(versions.map((v) => v.label)).toEqual([
      "Assembled from Ada Lovelace",
    ])
  })

  it("does not create a resume when the source does not exist", async () => {
    const h = harness()
    h.jobParser.result = PARSED_JOB

    await expect(
      h.tailorService.tailorFromJob({
        sourceResumeId: "missing",
        jobText: POSTING,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })

    expect(await h.resumeService.list()).toHaveLength(0)
    expect(h.jobParser.calls).toHaveLength(0)
  })

  it("refuses a posting too short to tailor against, before any model call", async () => {
    const h = harness()
    const base = await seed(h)

    await expect(
      h.tailorService.tailorFromJob({
        sourceResumeId: base.id,
        jobText: "Senior Engineer at Acme",
      })
    ).rejects.toMatchObject({ code: "VALIDATION" })

    expect(h.jobParser.calls).toHaveLength(0)
    expect(await h.resumeService.list()).toHaveLength(1)
  })

  it("records the run against the new resume, not the source", async () => {
    const h = harness()
    const base = await seed(h)
    h.jobParser.result = PARSED_JOB
    h.resumeTailor.result = TAILORED

    const result = await h.tailorService.tailorFromJob({
      sourceResumeId: base.id,
      jobText: POSTING,
    })

    const runs = h.db.runs
    expect(runs).toHaveLength(1)
    expect(runs[0]?.resumeId).toBe(result.resume.id)
    expect(runs[0]?.skillId).toBe("tailor_from_job")
  })
})
