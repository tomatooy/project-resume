import { describe, expect, it, vi } from "vitest"

import { harness } from "./harness"

async function seeded() {
  const h = harness()
  const { id } = await h.resumeService.create({ title: "CV" })
  return { ...h, resumeId: id }
}

async function edit(
  h: Awaited<ReturnType<typeof seeded>>,
  name: string
): Promise<void> {
  const record = await h.resumeService.get(h.resumeId)
  await h.resumeService.update({
    id: h.resumeId,
    data: { ...record.data, basics: { ...record.data.basics, name } },
    expectedRevision: record.revision,
  })
}

describe("VersionService", () => {
  it("numbers versions from one and lists them newest first", async () => {
    const h = await seeded()
    await h.versionService.snapshot(h.resumeId, { createdBy: "user" })
    await edit(h, "Ada")
    await h.versionService.snapshot(h.resumeId, { createdBy: "user" })

    const list = await h.versionService.list(h.resumeId)
    expect(list.map((v) => v.versionNo)).toEqual([2, 1])
    expect(list[0]?.label).toBe("Saved version")
  })

  it("does not write a second version when nothing changed", async () => {
    const h = await seeded()
    const first = await h.versionService.snapshot(h.resumeId, {
      createdBy: "user",
    })
    const second = await h.versionService.snapshot(h.resumeId, {
      createdBy: "user",
    })

    expect(second.id).toBe(first.id)
    expect(await h.versionService.list(h.resumeId)).toHaveLength(1)
  })

  it("writes again once the head has moved on", async () => {
    const h = await seeded()
    await h.versionService.snapshot(h.resumeId, { createdBy: "user" })
    await edit(h, "Ada")
    await h.versionService.snapshot(h.resumeId, { createdBy: "user" })

    expect(await h.versionService.list(h.resumeId)).toHaveLength(2)
  })

  it("restores content, labels the new version, and moves the token", async () => {
    const h = await seeded()
    const original = await h.resumeService.get(h.resumeId)
    const v1 = await h.versionService.snapshot(h.resumeId, {
      createdBy: "user",
    })
    await edit(h, "Ada")

    const restored = await h.versionService.restore(h.resumeId, v1.id)

    expect(restored.version.label).toBe(`Restored from v${v1.versionNo}`)
    expect(restored.version.createdBy).toBe("user")
    expect(restored.head.basics.name).toBe(original.data.basics.name)

    // The client swaps in this token; if it were stale the next keystroke
    // would come back as a conflict.
    const after = await h.resumeService.get(h.resumeId)
    expect(restored.revision).toBe(after.revision)
    expect(after.data.basics.name).toBe(original.data.basics.name)
  })

  it("refuses a version id belonging to another resume", async () => {
    const h = await seeded()
    const other = await h.resumeService.create({ title: "Other" })
    const version = await h.versionService.snapshot(other.id, {
      createdBy: "user",
    })

    await expect(
      h.versionService.restore(h.resumeId, version.id)
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("returns the stored document for a version", async () => {
    const h = await seeded()
    const v1 = await h.versionService.snapshot(h.resumeId, {
      createdBy: "user",
    })
    await edit(h, "Ada")

    const { content } = await h.versionService.getContent(v1.id)
    expect(content.basics.name).not.toBe("Ada")
  })
})

describe("VersionService.snapshotHead", () => {
  it("rereads once when an autosave lands during the snapshot", async () => {
    const h = await seeded()
    const create = h.versions.create.bind(h.versions)
    vi.spyOn(h.versions, "create").mockImplementationOnce(async (input) => {
      // The autosave lands between the read and the write, so this write
      // carries a stale revision.
      await edit(h, "Ada")
      return create(input)
    })

    const { version, resume } = await h.versionService.snapshotHead(
      h.resumeId,
      { label: "Autofill: Stripe · Software Engineer", createdBy: "system" }
    )

    expect(resume.data.basics.name).toBe("Ada")
    expect(version.label).toBe("Autofill: Stripe · Software Engineer")
    const stored = await h.versionService.getContent(version.id)
    expect(stored.content.basics.name).toBe("Ada")
    expect((await h.resumeService.get(h.resumeId)).data.basics.name).toBe("Ada")
  })

  it("gives up after a second conflict", async () => {
    const h = await seeded()
    const create = h.versions.create.bind(h.versions)
    let edits = 0
    vi.spyOn(h.versions, "create").mockImplementation(async (input) => {
      edits += 1
      await edit(h, `Edit ${edits}`)
      return create(input)
    })

    await expect(
      h.versionService.snapshotHead(h.resumeId, { createdBy: "system" })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    // Two attempts, each undone by an autosave; the user's last edit stands.
    expect((await h.resumeService.get(h.resumeId)).data.basics.name).toBe(
      "Edit 2"
    )
    expect(await h.versionService.list(h.resumeId)).toEqual([])
  })

  it("does not retry a failure that is not a conflict", async () => {
    const h = await seeded()
    vi.spyOn(h.versions, "create").mockRejectedValueOnce(new Error("boom"))

    await expect(
      h.versionService.snapshotHead(h.resumeId, { createdBy: "system" })
    ).rejects.toThrow("boom")
    expect(await h.versionService.list(h.resumeId)).toEqual([])
  })
})
