import { describe, expect, it } from "vitest"

import { InMemoryDb, InMemoryJobTargetRepository } from "../src/testing/index"
import { harness } from "./harness"

const POSTING = {
  platform: null,
  externalJobId: null,
  sourceUrl: "https://www.linkedin.com/jobs/view/4456278957/",
  rawText: "We are hiring a Senior Engineer.",
  title: "Senior Engineer",
  company: "Acme",
  location: "Remote",
  requirements: {
    mustHaves: ["TypeScript"],
    niceToHaves: [],
    keywords: ["React"],
  },
}

describe("InMemoryJobTargetRepository", () => {
  it("round-trips a posting", async () => {
    const repo = new InMemoryJobTargetRepository(new InMemoryDb())
    const created = await repo.create(POSTING)

    expect(created.company).toBe("Acme")
    expect(await repo.findById(created.id)).toEqual(created)
    expect(await repo.findById("missing")).toBeNull()
  })

  it("links a resume to a posting, and linking twice changes nothing", async () => {
    const repo = new InMemoryJobTargetRepository(new InMemoryDb())
    const target = await repo.create(POSTING)

    await repo.link({ resumeId: "r1", jobTargetId: target.id, isOrigin: true })
    await repo.link({ resumeId: "r1", jobTargetId: target.id, isOrigin: false })

    expect(await repo.listForResume("r1")).toEqual([target])
    expect(await repo.listForResume("r2")).toEqual([])
  })

  it("lists several postings against one resume", async () => {
    const repo = new InMemoryJobTargetRepository(new InMemoryDb())
    const first = await repo.create(POSTING)
    const second = await repo.create({ ...POSTING, company: "Babbage" })

    await repo.link({ resumeId: "r1", jobTargetId: first.id, isOrigin: true })
    await repo.link({ resumeId: "r1", jobTargetId: second.id, isOrigin: false })

    expect((await repo.listForResume("r1")).map((t) => t.company)).toEqual([
      "Babbage",
      "Acme",
    ])
  })

  it("lists origin jobs newest first", async () => {
    // The harness shares one store between resumes and postings, so a soft
    // delete is visible to the posting queries.
    const { resumeService, jobTargets } = harness()
    const a = await resumeService.create({ title: "A" })
    const b = await resumeService.create({ title: "B" })
    const c = await resumeService.create({ title: "C" })
    const d = await resumeService.create({ title: "D" })
    const stripe = await jobTargets.create({ ...POSTING, company: "Stripe" })
    const airbnb = await jobTargets.create({ ...POSTING, company: "Airbnb" })
    const figma = await jobTargets.create({ ...POSTING, company: "Figma" })
    await jobTargets.link({
      resumeId: a.id,
      jobTargetId: stripe.id,
      isOrigin: true,
    })
    await jobTargets.link({
      resumeId: b.id,
      jobTargetId: airbnb.id,
      isOrigin: true,
    })
    await jobTargets.link({
      resumeId: c.id,
      jobTargetId: figma.id,
      isOrigin: false,
    })
    await jobTargets.link({
      resumeId: d.id,
      jobTargetId: figma.id,
      isOrigin: true,
    })
    await resumeService.remove(d.id)

    const origins = await jobTargets.listOrigins(10)
    expect(origins.map((row) => row.resumeId)).toEqual([b.id, a.id])
    expect(origins[0]).toMatchObject({
      company: "Airbnb",
      title: "Senior Engineer",
    })
    expect(Number.isNaN(Date.parse(origins[0]?.linkedAt ?? ""))).toBe(false)
    expect(
      (await jobTargets.listOrigins(1)).map((row) => row.resumeId)
    ).toEqual([b.id])
    expect((await jobTargets.findOrigin(a.id))?.company).toBe("Stripe")
    expect(await jobTargets.findOrigin(c.id)).toBeNull()
  })
})
