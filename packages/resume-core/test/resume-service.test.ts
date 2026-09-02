import { describe, expect, it } from "vitest"

import { AppError } from "../src/domain/errors"
import { allNodeIds, harness } from "./harness"

describe("ResumeService", () => {
  it("creates a resume from the starter fixture", async () => {
    const { resumeService } = harness()
    const summary = await resumeService.create()

    expect(summary.title).toBe("Untitled resume")
    expect(summary.subtitle).toBe("Draft · not tailored")
    expect(summary.templateId).toBe("lisbon")

    const record = await resumeService.get(summary.id)
    expect(record.revision).toBe(1)
    expect(record.currentVersionId).toBeNull()
  })

  it("moves the revision on a document write and returns the new token", async () => {
    const { resumeService } = harness()
    const { id } = await resumeService.create()
    const before = await resumeService.get(id)

    const written = await resumeService.update({
      id,
      data: { ...before.data, basics: { ...before.data.basics, name: "Ada" } },
      expectedRevision: before.revision,
    })

    expect(written.revision).toBe(before.revision + 1)
    expect((await resumeService.get(id)).data.basics.name).toBe("Ada")
  })

  it("rejects a write carrying a stale revision", async () => {
    const { resumeService } = harness()
    const { id } = await resumeService.create()
    const before = await resumeService.get(id)

    await resumeService.update({
      id,
      data: { ...before.data, basics: { ...before.data.basics, name: "Ada" } },
      expectedRevision: before.revision,
    })

    // A second tab still holding the old token.
    await expect(
      resumeService.update({
        id,
        data: {
          ...before.data,
          basics: { ...before.data.basics, name: "Grace" },
        },
        expectedRevision: before.revision,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("overwrites when no revision is supplied", async () => {
    const { resumeService } = harness()
    const { id } = await resumeService.create()
    const before = await resumeService.get(id)

    await resumeService.update({
      id,
      data: { ...before.data, basics: { ...before.data.basics, name: "Ada" } },
      expectedRevision: before.revision,
    })

    const forced = await resumeService.update({
      id,
      data: {
        ...before.data,
        basics: { ...before.data.basics, name: "Grace" },
      },
    })
    expect(forced.revision).toBe(before.revision + 2)
  })

  it("leaves the revision alone on rename and template change", async () => {
    const { resumeService } = harness()
    const { id } = await resumeService.create()
    const before = await resumeService.get(id)

    await resumeService.rename(id, "Product design")
    await resumeService.setTemplate(id, "harbor", {
      pageSize: "A4",
      fontScale: 1.1,
    })

    const after = await resumeService.get(id)
    expect(after.title).toBe("Product design")
    expect(after.templateId).toBe("harbor")
    // The whole point of the separate token: an in-flight autosave must still
    // be accepted after a rename.
    expect(after.revision).toBe(before.revision)
    expect(after.updatedAt > before.updatedAt).toBe(true)

    await expect(
      resumeService.update({
        id,
        data: after.data,
        expectedRevision: before.revision,
      })
    ).resolves.toBeDefined()
  })

  it("falls back to a placeholder title when a rename is blank", async () => {
    const { resumeService } = harness()
    const { id } = await resumeService.create({ title: "Named" })
    await resumeService.rename(id, "   ")
    expect((await resumeService.get(id)).title).toBe("Untitled resume")
  })

  it("regenerates every node id when duplicating", async () => {
    const { resumeService } = harness()
    const source = await resumeService.create({ title: "Original" })
    const sourceRecord = await resumeService.get(source.id)

    const copy = await resumeService.duplicate(source.id)
    const copyRecord = await resumeService.get(copy.id)

    expect(copy.title).toBe("Original copy")
    const originalIds = allNodeIds(sourceRecord.data)
    const copyIds = allNodeIds(copyRecord.data)
    expect(copyIds).toHaveLength(originalIds.length)
    // `basics` is the one fixed id and is expected to repeat.
    const shared = copyIds.filter(
      (id) => id !== "basics" && originalIds.includes(id)
    )
    expect(shared).toEqual([])
  })

  it("rejects a document that fails its own schema", async () => {
    const { resumeService } = harness()
    const { id } = await resumeService.create()
    const record = await resumeService.get(id)

    await expect(
      resumeService.update({
        id,
        data: { ...record.data, basics: { ...record.data.basics, name: "" } },
      })
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("hides soft-deleted resumes from the list and from reads", async () => {
    const { resumeService } = harness()
    const { id } = await resumeService.create()
    await resumeService.remove(id)

    expect(await resumeService.list()).toEqual([])
    await expect(resumeService.get(id)).rejects.toBeInstanceOf(AppError)
  })
})
