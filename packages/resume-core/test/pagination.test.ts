import { describe, expect, it, vi } from "vitest"
import { ResumePageInputSchema } from "../src"
import { harness } from "./harness"

describe("bounded resume queries", () => {
  it("walks tied timestamps without duplicates and excludes deleted rows", async () => {
    const { db, resumeService } = harness()
    for (let i = 0; i < 65; i++)
      await resumeService.create({ title: `Resume ${i}` })
    for (const row of db.resumes) row.updatedAt = "2026-09-25T00:00:00.000Z"
    const deleted = db.resumes[0]
    if (!deleted) throw new Error()
    deleted.deletedAt = deleted.updatedAt
    const first = await resumeService.page()
    expect(first.items).toHaveLength(30)
    expect(first.total).toBe(64)
    const second = await resumeService.page({
      cursor: first.nextCursor ?? undefined,
    })
    const third = await resumeService.page({
      cursor: second.nextCursor ?? undefined,
    })
    expect(second.total).toBeUndefined()
    expect(third.nextCursor).toBeNull()
    const ids = [...first.items, ...second.items, ...third.items].map(
      (row) => row.id
    )
    expect(new Set(ids).size).toBe(64)
    expect(ids).toEqual([...ids].sort().reverse())
    await expect(resumeService.summary(deleted.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })
  it("validates cursor values before constructing a database filter", () => {
    expect(
      ResumePageInputSchema.safeParse({ cursor: "2026-09-25|bad),id.gt.0" })
        .success
    ).toBe(false)
    expect(
      ResumePageInputSchema.safeParse({
        cursor: "2026-99-25T00:00:00Z|00000000-0000-4000-8000-000000000001",
      }).success
    ).toBe(false)
  })
  it("continues past false-positive candidates and keeps title-any/body-all semantics", async () => {
    const { resumeService, resumes, db } = harness()
    const target = await resumeService.create({
      title: "Target",
      document: {
        schemaVersion: 1,
        basics: {
          id: "basics",
          name: "typescript",
          summary: "platform",
          links: [],
        },
        sections: [],
      },
    })
    for (let i = 0; i < 60; i++)
      await resumeService.create({
        title: "Unrelated",
        document: {
          schemaVersion: 1,
          basics: { id: "basics", name: "unrelated", links: [] },
          sections: [],
        },
      })
    const titled = await resumeService.create({
      title: "Typescript role",
      document: {
        schemaVersion: 1,
        basics: { id: "basics", name: "Jo", links: [] },
        sections: [],
      },
    })
    const read = vi.spyOn(resumes, "searchCandidates")
    const result = await resumeService.search("typescript platform")
    expect(result.scanned).toBe(db.resumes.length)
    expect(result.groups.map((group) => group.resume.id)).toEqual([
      titled.id,
      target.id,
    ])
    expect(result.groups[1]?.hits).toHaveLength(2)
    expect(
      read.mock.calls.filter((call) => call[1] === "body").length
    ).toBeGreaterThan(1)
  })
  it("loads versions by version number and fetches content only on selection", async () => {
    const { resumeService, versionService } = harness()
    const resume = await resumeService.create()
    for (let i = 0; i < 65; i++) {
      const record = await resumeService.get(resume.id)
      record.data.basics.name = String(i)
      await resumeService.update({ id: resume.id, data: record.data })
      await versionService.snapshot(resume.id, { createdBy: "user" })
    }
    const first = await versionService.page(resume.id)
    const second = await versionService.page(
      resume.id,
      first.nextCursor ?? undefined
    )
    const third = await versionService.page(
      resume.id,
      second.nextCursor ?? undefined
    )
    expect(first.items).toHaveLength(30)
    expect(third.items).toHaveLength(5)
    expect(third.nextCursor).toBeNull()
    expect(
      [...first.items, ...second.items, ...third.items].map((v) => v.versionNo)
    ).toEqual(Array.from({ length: 65 }, (_, i) => 65 - i))
    expect(first.items[0]).not.toHaveProperty("content")
  })
})
