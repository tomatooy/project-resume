import { describe, expect, it } from "vitest"

import { InMemoryDb, InMemoryJobTargetRepository } from "../src/testing/index"

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
})
