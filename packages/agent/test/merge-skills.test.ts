import type { CustomSkill, SkillOverlay } from "@workspace/resume-core"
import { describe, expect, it } from "vitest"

import { SKILL_IDS } from "../src/skills/catalog"
import { mergeSkills, resolveSkills } from "../src/skills/merge"
import { SKILLS } from "../src/skills/library"

function custom(overrides: Partial<CustomSkill> = {}): CustomSkill {
  return {
    id: "usr_11111111-1111-4111-8111-111111111111",
    category: "editor",
    name: "Terse sentences",
    description: "Make sentences shorter.",
    whenToUse: "The prose is wordy and the user wants it shorter.",
    body: "Prefer one clause per sentence.",
    createdAt: "2026-09-12T00:00:00.000Z",
    ...overrides,
  }
}

function overlay(overrides: Partial<SkillOverlay> = {}): SkillOverlay {
  return { custom: [], disabledIds: [], ...overrides }
}

describe("mergeSkills", () => {
  it("keeps the built-ins first, in catalog order", () => {
    const entries = mergeSkills(overlay())
    expect(entries.map((entry) => entry.skill.id)).toEqual([...SKILL_IDS])
    expect(entries.every((entry) => entry.source === "builtin")).toBe(true)
  })

  it("appends custom skills oldest first, whatever order the rows arrive in", () => {
    const first = custom({
      id: "usr_a",
      createdAt: "2026-09-12T00:00:00.000Z",
    })
    const second = custom({
      id: "usr_b",
      createdAt: "2026-09-13T00:00:00.000Z",
    })

    const entries = mergeSkills(overlay({ custom: [second, first] }))

    expect(entries.slice(SKILLS.length).map((entry) => entry.skill.id)).toEqual(
      ["usr_a", "usr_b"]
    )
    expect(entries.at(-1)?.source).toBe("custom")
  })

  it("wraps a custom body once, and leaves the built-ins alone", () => {
    const entries = mergeSkills(
      overlay({ custom: [custom({ body: "Prefer one clause." })] })
    )
    const builtin = entries.find((entry) => entry.skill.id === "bullet_rewrite")
    const written = entries.find((entry) => entry.source === "custom")

    expect(written?.skill.body).toContain("User-authored playbook")
    expect(written?.skill.body).toContain("Prefer one clause.")
    expect(builtin?.skill.body).not.toContain("User-authored playbook")
  })

  it("marks a deleted row rather than dropping it", () => {
    const entries = mergeSkills(
      overlay({
        custom: [
          custom({
            id: "usr_gone",
            deletedAt: "2026-09-13T00:00:00.000Z",
          }),
        ],
      })
    )

    const gone = entries.find((entry) => entry.skill.id === "usr_gone")
    expect(gone?.deleted).toBe(true)
    // An old card still names it, which is the whole reason it stays here.
    expect(gone?.skill.name).toBe("Terse sentences")
  })

  it("marks a disabled entry on either tier", () => {
    const entries = mergeSkills(
      overlay({
        custom: [custom({ id: "usr_a" })],
        disabledIds: ["bullet_rewrite", "usr_a"],
      })
    )

    expect(
      entries.find((entry) => entry.skill.id === "bullet_rewrite")?.enabled
    ).toBe(false)
    expect(entries.find((entry) => entry.skill.id === "usr_a")?.enabled).toBe(
      false
    )
  })
})

describe("resolveSkills", () => {
  it("returns the built-in library for an empty overlay", () => {
    expect(resolveSkills(overlay())).toEqual([...SKILLS])
  })

  it("drops disabled and deleted entries, keeping the order", () => {
    const kept = custom({ id: "usr_kept" })
    const removed = custom({
      id: "usr_removed",
      deletedAt: "2026-09-13T00:00:00.000Z",
    })
    const disabled = custom({ id: "usr_disabled" })

    const skills = resolveSkills(
      overlay({
        custom: [kept, removed, disabled],
        disabledIds: ["jd_match", "usr_disabled"],
      })
    )
    const ids = skills.map((skill) => skill.id)

    expect(ids).not.toContain("jd_match")
    expect(ids).not.toContain("usr_removed")
    expect(ids).not.toContain("usr_disabled")
    expect(ids).toContain("usr_kept")
    expect(ids.indexOf("bullet_rewrite")).toBeLessThan(ids.indexOf("usr_kept"))
  })

  it("can be empty when everything is switched off", () => {
    expect(
      resolveSkills(overlay({ disabledIds: [...SKILL_IDS], custom: [] }))
    ).toEqual([])
  })
})
