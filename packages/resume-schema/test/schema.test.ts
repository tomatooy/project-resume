import { describe, expect, it } from "vitest"
import {
  applyStrict,
  breadcrumb,
  contentHash,
  diffDocuments,
  findNode,
  formatRange,
  indexNodes,
  migrateResume,
  regenerateIds,
  ResumeSchema,
  validatePatches,
  type Resume,
  type ResumePatch,
  type StrictApplyResult,
} from "../src/index"
import { textFields } from "../src/nodes"
import {
  longBullets,
  minimal,
  onePage,
  starter,
  twoPage,
  unicode,
} from "../src/fixtures/index"

const ALL_FIXTURES = {
  starter,
  minimal,
  onePage,
  twoPage,
  longBullets,
  unicode,
}

const meta = { reason: "test", skillId: "bullet_rewrite" } as const

/**
 * `applyStrict` carries no document on its failure branch, so a test that
 * wants the result narrows here and fails loudly rather than reading through
 * an optional.
 */
function applyOk(
  resume: Resume,
  patches: ResumePatch[]
): Extract<StrictApplyResult, { ok: true }> {
  const result = applyStrict(resume, patches)
  if (!result.ok) {
    throw new Error(`expected the patches to apply: ${result.failed[0]?.code}`)
  }
  return result
}

function firstBulletId(): string {
  const bullet = onePage.sections[0]?.items[0]
  if (!bullet || bullet.kind === "skills") throw new Error("bad fixture")
  const id = bullet.bullets[0]?.id
  if (!id) throw new Error("bad fixture")
  return id
}

function firstBulletText(): string {
  const item = onePage.sections[0]?.items[0]
  if (!item || item.kind === "skills") throw new Error("bad fixture")
  return item.bullets[0]?.text ?? ""
}

describe("fixtures", () => {
  for (const [name, fixture] of Object.entries(ALL_FIXTURES)) {
    it(`${name} parses`, () => {
      expect(ResumeSchema.safeParse(fixture).success).toBe(true)
    })
  }

  it("rejects duplicate node ids", () => {
    const broken = structuredClone(onePage)
    const section = broken.sections[0]
    const other = broken.sections[1]
    if (!section || !other) throw new Error("bad fixture")
    other.id = section.id
    expect(ResumeSchema.safeParse(broken).success).toBe(false)
  })

  it("rejects items whose kind does not match the section type", () => {
    const broken = structuredClone(onePage)
    const skills = broken.sections.find((s) => s.type === "skills")
    const experience = broken.sections.find((s) => s.type === "experience")
    if (!skills || !experience) throw new Error("bad fixture")
    const item = experience.items[0]
    if (!item) throw new Error("bad fixture")
    skills.items = [item]
    expect(ResumeSchema.safeParse(broken).success).toBe(false)
  })
})

describe("ids", () => {
  it("regenerateIds keeps the document valid and shares no ids", () => {
    const copy = regenerateIds(onePage)
    expect(ResumeSchema.safeParse(copy).success).toBe(true)
    const before = new Set(indexNodes(onePage).keys())
    const after = [...indexNodes(copy).keys()].filter((id) => id !== "basics")
    expect(after.some((id) => before.has(id))).toBe(false)
  })
})

describe("nodes", () => {
  it("indexes every addressable node", () => {
    const index = indexNodes(onePage)
    expect(index.get("basics")?.kind).toBe("basics")
    expect(index.get(firstBulletId())?.kind).toBe("bullet")
  })

  it("builds a readable breadcrumb", () => {
    expect(breadcrumb(onePage, firstBulletId())).toBe(
      "Experience > Vipps MobilePay > bullet 1"
    )
  })

  it("only advertises text fields the node actually has", () => {
    const skills = findNode(onePage, onePage.sections[3]?.items[0]?.id ?? "")
    expect(skills).toBeDefined()
    const fields = textFields("item", skills?.node)
    expect(fields).toContain("label")
    expect(fields).not.toContain("company")
  })
})

describe("formatRange", () => {
  it("formats a closed range", () => {
    expect(formatRange("2022-03", "2024-11")).toBe("Mar 2022 - Nov 2024")
  })
  it("formats an open range", () => {
    expect(formatRange("2022-03", "present")).toBe("Mar 2022 - Present")
  })
  it("tolerates a missing start", () => {
    expect(formatRange(undefined, "2024-11")).toBe("Nov 2024")
  })
  it("returns empty for no dates", () => {
    expect(formatRange(undefined, undefined)).toBe("")
  })
})

describe("applyStrict", () => {
  it("replaces text and reports an inverse that restores it", () => {
    const patch: ResumePatch = {
      ...meta,
      op: "replace_text",
      targetNodeId: firstBulletId(),
      field: "text",
      before: firstBulletText(),
      after: "Rewrote the settlement ledger.",
    }
    const result = applyOk(onePage, [patch])
    expect(result.failed).toEqual([])
    expect(findNode(result.resume, firstBulletId())).toMatchObject({
      node: { text: "Rewrote the settlement ledger." },
    })

    const inverse = result.applied[0]?.inverse
    expect(inverse).toBeDefined()
    const back = applyOk(result.resume, [inverse as ResumePatch])
    expect(back.failed).toEqual([])
    expect(findNode(back.resume, firstBulletId())).toMatchObject({
      node: { text: firstBulletText() },
    })
  })

  it("rejects a stale before value", () => {
    const result = applyStrict(onePage, [
      {
        ...meta,
        op: "replace_text",
        targetNodeId: firstBulletId(),
        field: "text",
        before: "something the document never said",
        after: "new text",
      },
    ])
    expect(result.failed[0]?.code).toBe("BEFORE_MISMATCH")
  })

  it("does not leave the source document mutated", () => {
    const snapshot = JSON.stringify(onePage)
    applyStrict(onePage, [
      {
        ...meta,
        op: "delete",
        targetNodeId: firstBulletId(),
        before: {},
      },
    ])
    expect(JSON.stringify(onePage)).toBe(snapshot)
  })

  it("assigns fresh ids on insert and undoes with a delete", () => {
    const parentId = onePage.sections[0]?.items[0]?.id ?? ""
    const result = applyOk(onePage, [
      {
        ...meta,
        op: "insert_after",
        parentId,
        afterNodeId: null,
        node: { id: "bul_attacker0", text: "Inserted bullet." },
      },
    ])
    expect(result.failed).toEqual([])
    const assigned = result.applied[0]?.assignedIds?.[0]
    expect(assigned).toBeDefined()
    expect(assigned).not.toBe("bul_attacker0")
    expect(result.applied[0]?.inverse.op).toBe("delete")
  })

  it("moves within a parent and inverts the move", () => {
    const section = onePage.sections[0]
    const target = section?.items[1]?.id ?? ""
    const result = applyOk(onePage, [
      { ...meta, op: "move", targetNodeId: target, toIndex: 0 },
    ])
    expect(result.failed).toEqual([])
    expect(result.resume.sections[0]?.items[0]?.id).toBe(target)
    const back = applyOk(result.resume, [
      result.applied[0]?.inverse as ResumePatch,
    ])
    expect(back.resume.sections[0]?.items[0]?.id).toBe(section?.items[0]?.id)
  })

  it("refuses a move past the end of the parent", () => {
    const result = applyStrict(onePage, [
      {
        ...meta,
        op: "move",
        targetNodeId: onePage.sections[0]?.id ?? "",
        toIndex: 99,
      },
    ])
    expect(result.failed[0]?.code).toBe("INDEX_OUT_OF_RANGE")
  })
})

describe("validatePatches", () => {
  const base = { allowStructural: false }

  it("refuses a structural patch when the request did not ask for one", () => {
    const section = onePage.sections[0]
    if (!section) throw new Error("bad fixture")
    const { rejected } = validatePatches(
      onePage,
      [
        {
          ...meta,
          op: "delete",
          targetNodeId: section.id,
          before: section,
        },
      ],
      base
    )
    expect(rejected[0]?.code).toBe("STRUCTURAL_NOT_REQUESTED")
    expect(rejected[0]?.message).toBe("delete a section")
  })

  it("allows a structural patch once the flag is set", () => {
    const section = onePage.sections[0]
    if (!section) throw new Error("bad fixture")
    const { valid, rejected } = validatePatches(
      onePage,
      [
        {
          ...meta,
          op: "delete",
          targetNodeId: section.id,
          before: section,
        },
      ],
      { allowStructural: true }
    )
    expect(rejected).toEqual([])
    expect(valid).toHaveLength(1)
  })

  it("keeps patches inside the requested scope", () => {
    const otherBullet = onePage.sections[0]?.items[1]
    if (!otherBullet || otherBullet.kind === "skills")
      throw new Error("bad fixture")
    const { rejected } = validatePatches(
      onePage,
      [
        {
          ...meta,
          op: "replace_text",
          targetNodeId: otherBullet.bullets[0]?.id ?? "",
          field: "text",
          before: otherBullet.bullets[0]?.text ?? "",
          after: "Different text entirely.",
        },
      ],
      {
        ...base,
        scopeNodeId: onePage.sections[0]?.items[0]?.id,
      }
    )
    expect(rejected[0]?.code).toBe("OUT_OF_SCOPE")
  })

  it("refuses to write a structural field", () => {
    const { rejected } = validatePatches(
      onePage,
      [
        {
          ...meta,
          op: "update_fields",
          targetNodeId: onePage.sections[0]?.items[0]?.id ?? "",
          before: { bullets: [] },
          after: { bullets: [] },
        },
      ],
      base
    )
    expect(rejected[0]?.code).toBe("FIELD_NOT_ALLOWED")
  })
})

describe("diff and hash", () => {
  it("reports a changed bullet and nothing else", () => {
    const next = applyOk(onePage, [
      {
        ...meta,
        op: "replace_text",
        targetNodeId: firstBulletId(),
        field: "text",
        before: firstBulletText(),
        after: "A different bullet.",
      },
    ]).resume
    const diff = diffDocuments(onePage, next)
    expect(diff).toHaveLength(1)
    expect(diff[0]).toMatchObject({ id: firstBulletId(), change: "changed" })
  })

  it("says which field changed and what it went from and to", () => {
    const next = applyOk(onePage, [
      {
        ...meta,
        op: "replace_text",
        targetNodeId: firstBulletId(),
        field: "text",
        before: firstBulletText(),
        after: "A different bullet.",
      },
    ]).resume

    expect(diffDocuments(onePage, next)[0]?.fields).toEqual([
      {
        field: "text",
        before: firstBulletText(),
        after: "A different bullet.",
      },
    ])
  })

  it("reports one entry per changed field and leaves the rest out", () => {
    const item = onePage.sections[0]?.items[0]
    if (item?.kind !== "experience") throw new Error("bad fixture")
    const next = applyOk(onePage, [
      {
        ...meta,
        skillId: "grammar_clarity",
        op: "update_fields",
        targetNodeId: item.id,
        before: { role: item.role },
        after: { role: "Staff Engineer" },
      },
    ]).resume

    expect(diffDocuments(onePage, next)[0]?.fields).toEqual([
      { field: "role", before: item.role, after: "Staff Engineer" },
    ])
  })

  it("carries an absent value through as undefined rather than a string", () => {
    const item = onePage.sections[0]?.items[0]
    if (item?.kind !== "experience") throw new Error("bad fixture")
    const next = applyOk(onePage, [
      {
        ...meta,
        skillId: "grammar_clarity",
        op: "update_fields",
        targetNodeId: item.id,
        before: { location: item.location },
        after: { location: "Berlin" },
      },
    ]).resume

    const [change] = diffDocuments(onePage, next)[0]?.fields ?? []
    expect(change).toEqual({
      field: "location",
      before: item.location,
      after: "Berlin",
    })
  })

  it("leaves fields off a move, which changes position and nothing else", () => {
    const section = onePage.sections[0]
    const item = section?.items[1]
    if (!section || !item) throw new Error("bad fixture")
    const next = applyOk(onePage, [
      {
        ...meta,
        skillId: "grammar_clarity",
        op: "move",
        targetNodeId: item.id,
        toIndex: 0,
      },
    ]).resume

    const moved = diffDocuments(onePage, next).find((d) => d.id === item.id)
    expect(moved).toMatchObject({ change: "moved", before: 1, after: 0 })
    expect(moved?.fields).toBeUndefined()
  })

  it("hashes structurally equal documents the same", async () => {
    const [a, b] = await Promise.all([
      contentHash(onePage),
      contentHash(JSON.parse(JSON.stringify(onePage))),
    ])
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
  })

  it("hashes different documents differently", async () => {
    const [a, b] = await Promise.all([
      contentHash(onePage),
      contentHash(twoPage),
    ])
    expect(a).not.toBe(b)
  })
})

describe("migrateResume", () => {
  it("passes through a current document", () => {
    expect(migrateResume(structuredClone(starter))).toEqual(starter)
  })
  it("throws on junk", () => {
    expect(() => migrateResume({ nope: true })).toThrow()
  })
})
