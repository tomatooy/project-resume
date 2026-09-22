import { describe, expect, it } from "vitest"

import {
  MAX_CUSTOM_SKILLS,
  MAX_SKILL_BODY_CHARS,
  type UserSkillInput,
} from "../src/domain/skill"
import { harness } from "./harness"

const input: UserSkillInput = {
  category: "editor",
  name: "Terse sentences",
  description: "Make sentences shorter.",
  whenToUse: "The prose is wordy and the user wants it shorter.",
  body: "Prefer one clause per sentence.",
}

describe("SkillService", () => {
  it("guards writes even when a caller bypasses the form", async () => {
    const h = harness()
    await expect(
      h.skillService.create({ ...input, description: " " })
    ).rejects.toMatchObject({ code: "VALIDATION" })
    expect((await h.skillService.listOverlay()).custom).toEqual([])
    const created = await h.skillService.create(input)
    await expect(
      h.skillService.update(created.id, {
        ...input,
        body: "x".repeat(MAX_SKILL_BODY_CHARS + 1),
      })
    ).rejects.toMatchObject({ code: "VALIDATION" })
    expect((await h.skillService.get(created.id)).body).toBe(input.body)
  })

  it("can clear when to use while preserving the description", async () => {
    const h = harness()
    const created = await h.skillService.create(input)
    const updated = await h.skillService.update(created.id, {
      ...input,
      whenToUse: undefined,
    })
    expect(updated.whenToUse).toBeUndefined()
    expect(updated.description).toBe(input.description)
  })

  it("creates a skill under a usr_ id and lists it in the overlay", async () => {
    const h = harness()

    const created = await h.skillService.create(input)

    expect(created.id.startsWith("usr_")).toBe(true)
    expect(created.createdAt).toBeTruthy()
    expect(created.category).toBe("editor")
    const overlay = await h.skillService.listOverlay()
    expect(overlay.custom.map((row) => row.id)).toEqual([created.id])
  })

  it("returns one live row for the editor", async () => {
    const h = harness()
    const created = await h.skillService.create(input)

    expect((await h.skillService.get(created.id)).body).toBe(input.body)
  })

  it("refuses a skill past the cap", async () => {
    const h = harness()
    for (let i = 0; i < MAX_CUSTOM_SKILLS; i += 1) {
      await h.skillService.create({ ...input, name: `Skill ${i}` })
    }

    await expect(
      h.skillService.create({ ...input, name: "One too many" })
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("counts live rows only, so deleting frees a slot", async () => {
    const h = harness()
    const rows = []
    for (let i = 0; i < MAX_CUSTOM_SKILLS; i += 1) {
      rows.push(await h.skillService.create({ ...input, name: `Skill ${i}` }))
    }
    const first = rows[0]
    if (!first) throw new Error("nothing was created")

    await h.skillService.remove(first.id)
    const replacement = await h.skillService.create({
      ...input,
      name: "Replacement",
    })

    expect(replacement.name).toBe("Replacement")
  })

  it("keeps a soft-deleted row in the overlay so an old card can name it", async () => {
    const h = harness()
    const created = await h.skillService.create(input)

    await h.skillService.remove(created.id)

    const overlay = await h.skillService.listOverlay()
    const row = overlay.custom.find((entry) => entry.id === created.id)
    expect(row?.name).toBe(input.name)
    expect(row?.deletedAt).toBeTruthy()
  })

  it("treats a deleted row as gone for reads and writes", async () => {
    const h = harness()
    const created = await h.skillService.create(input)
    await h.skillService.remove(created.id)

    await expect(h.skillService.get(created.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
    await expect(
      h.skillService.update(created.id, { ...input, name: "Renamed" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(h.skillService.remove(created.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })

  it("treats an unknown id as not found", async () => {
    const h = harness()
    await expect(h.skillService.remove("usr_nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })

  it("updates the row in place", async () => {
    const h = harness()
    const created = await h.skillService.create(input)

    const updated = await h.skillService.update(created.id, {
      ...input,
      name: "Punchier",
    })

    expect(updated.id).toBe(created.id)
    expect(updated.name).toBe("Punchier")
    expect((await h.skillService.listOverlay()).custom).toHaveLength(1)
  })

  it("toggles any id off and on", async () => {
    const h = harness()

    await h.skillService.setDisabled("bullet_rewrite", true)
    await h.skillService.setDisabled("bullet_rewrite", true)
    expect((await h.skillService.listOverlay()).disabledIds).toEqual([
      "bullet_rewrite",
    ])

    await h.skillService.setDisabled("bullet_rewrite", false)
    expect((await h.skillService.listOverlay()).disabledIds).toEqual([])
  })

  it("parses markdown without saving anything", async () => {
    const h = harness()
    const file =
      "---\nname: Terse\ndescription: Wordy prose.\n---\n\nShort sentences."

    const parsed = h.skillService.importMarkdown(file)

    expect(parsed.description).toBe("Wordy prose.")
    expect(parsed.whenToUse).toBeUndefined()
    expect((await h.skillService.listOverlay()).custom).toEqual([])
  })
})
