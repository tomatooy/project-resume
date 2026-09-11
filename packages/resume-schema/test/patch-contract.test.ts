import { describe, expect, it } from "vitest"
import {
  addedFigures,
  applyDraft,
  applyStrict,
  type ResumePatch,
  validatePatches,
} from "../src/index"
import { minimal, onePage } from "../src/fixtures/index"
import type { Section } from "../src/schema"

/**
 * The behaviours the patch contract gained when skills stopped being the
 * enforcement key: the root pseudo-parent, `update_fields` clearing with
 * `null`, cross-parent moves, contact-field reach, and the structural tier
 * that the request's flag, not the model, decides.
 */

const meta = { reason: "Test patch", skillId: "test" } as const

function section(index: number): Section {
  const found = onePage.sections[index]
  if (!found) throw new Error("bad fixture")
  return found
}

function firstConcreteItem() {
  const item = section(0).items[0]
  if (!item || item.kind === "skills") throw new Error("bad fixture")
  return item
}

function secondConcreteItem() {
  const item = section(0).items[1]
  if (!item || item.kind === "skills") throw new Error("bad fixture")
  return item
}

function strict(resume: typeof onePage, patches: ResumePatch[]) {
  const result = applyStrict(resume, patches)
  if (!result.ok) throw new Error(`patch failed: ${result.failed[0]?.code}`)
  return result
}

/** Content without the ids, which `insert_after` always restamps. */
function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds)
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "id")
        .map(([key, entry]) => [key, withoutIds(entry)])
    )
  }
  return value
}

describe("the root parent", () => {
  it("adds a whole section with its items and bullets in one patch", () => {
    const patch: ResumePatch = {
      ...meta,
      op: "insert_after",
      parentId: "root",
      afterNodeId: null,
      node: {
        type: "projects",
        title: "Open source",
        items: [
          {
            kind: "project",
            name: "tinyfmt",
            bullets: [{ text: "A formatter nobody asked for." }],
          },
        ],
      },
    }

    const result = strict(onePage, [patch])

    const added = result.resume.sections[0]
    expect(added?.title).toBe("Open source")
    expect(added?.id.startsWith("sec_")).toBe(true)
    const item = added?.items[0]
    if (item?.kind !== "project") throw new Error("lost the item")
    expect(item.id.startsWith("prj_")).toBe(true)
    expect(item.bullets[0]?.id.startsWith("bul_")).toBe(true)
    // The section, its item and its bullet all report an assigned id.
    expect(result.applied[0]?.assignedIds).toHaveLength(3)
  })

  it("appends after the last section", () => {
    const last = section(onePage.sections.length - 1)
    const patch: ResumePatch = {
      ...meta,
      op: "insert_after",
      parentId: "root",
      afterNodeId: last.id,
      node: { type: "custom", title: "Speaking", items: [] },
    }

    const result = strict(onePage, [patch])

    expect(result.resume.sections.at(-1)?.title).toBe("Speaking")
    expect(result.resume.sections).toHaveLength(onePage.sections.length + 1)
  })

  it("undoes a section delete instead of silently doing nothing", () => {
    // The regression this guards: the inverse used to name `basics` as the
    // parent, which cannot hold a section, so undo popped the entry and
    // returned false without changing the document.
    const target = section(1)
    const deleted = applyDraft(onePage, [
      { ...meta, op: "delete", targetNodeId: target.id, before: target },
    ])
    const inverse = deleted.applied[0]?.inverse
    expect(inverse?.op).toBe("insert_after")
    if (inverse?.op !== "insert_after") throw new Error("no inverse")
    expect(inverse.parentId).toBe("root")

    const restored = applyDraft(deleted.resume, [inverse])

    expect(restored.failed).toEqual([])
    // Ids are restamped on insert, the way they are for any addition; what
    // undo restores is the content and its place in the document.
    expect(restored.resume.sections.map((s) => s.title)).toEqual(
      onePage.sections.map((s) => s.title)
    )
    const before = onePage.sections[1]
    const after = restored.resume.sections[1]
    expect(after?.items).toHaveLength(before?.items.length ?? -1)
    expect(withoutIds(after?.items)).toEqual(withoutIds(before?.items))
  })
})

describe("update_fields", () => {
  it("clears an optional field with null and restores it with the inverse", () => {
    const summary = onePage.basics.summary
    const cleared = strict(onePage, [
      {
        ...meta,
        op: "update_fields",
        targetNodeId: "basics",
        before: { summary },
        after: { summary: null },
      },
    ])

    expect(cleared.resume.basics.summary).toBeUndefined()

    const inverse = cleared.applied[0]?.inverse
    if (!inverse) throw new Error("no inverse")
    const back = strict(cleared.resume, [inverse])
    expect(back.resume.basics.summary).toBe(summary)
  })

  it("treats an absent field and a null one as the same state", () => {
    // `minimal` has no headline, so `before: { headline: null }` matches it.
    const result = validatePatches(
      minimal,
      [
        {
          ...meta,
          op: "update_fields",
          targetNodeId: "basics",
          before: { headline: null },
          after: { headline: "Backend engineer" },
        },
      ],
      { allowStructural: false }
    )

    expect(result.rejected).toEqual([])
    expect(result.valid).toHaveLength(1)
  })

  it("refuses to clear a required field, naming it", () => {
    const { rejected } = validatePatches(
      onePage,
      [
        {
          ...meta,
          op: "update_fields",
          targetNodeId: "basics",
          before: { name: onePage.basics.name },
          after: { name: null },
        },
      ],
      { allowStructural: false }
    )

    expect(rejected[0]?.code).toBe("REQUIRED_FIELD")
    expect(rejected[0]?.message).toBe("name")
  })

  it("refuses before and after that do not cover the same fields", () => {
    const { rejected } = validatePatches(
      onePage,
      [
        {
          ...meta,
          op: "update_fields",
          targetNodeId: "basics",
          before: { headline: onePage.basics.headline },
          after: { headline: "Backend engineer", summary: null },
        },
      ],
      { allowStructural: false }
    )

    expect(rejected[0]?.code).toBe("BEFORE_MISMATCH")
  })

  it("refuses a field the node does not have", () => {
    const { rejected } = validatePatches(
      onePage,
      [
        {
          ...meta,
          op: "update_fields",
          targetNodeId: "basics",
          before: { nickname: null },
          after: { nickname: "Mira" },
        },
      ],
      { allowStructural: false }
    )

    expect(rejected[0]?.code).toBe("FIELD_NOT_ALLOWED")
  })

  it("refuses to rewrite a section type", () => {
    const target = section(0)
    const { rejected } = validatePatches(
      onePage,
      [
        {
          ...meta,
          op: "update_fields",
          targetNodeId: target.id,
          before: { type: target.type },
          after: { type: "projects" },
        },
      ],
      { allowStructural: true }
    )

    expect(rejected[0]?.code).toBe("FIELD_NOT_ALLOWED")
  })

  it("adds and removes skill chips and still parses", () => {
    const group = section(3).items[0]
    if (group?.kind !== "skills") throw new Error("bad fixture")

    const added = strict(onePage, [
      {
        ...meta,
        op: "update_fields",
        targetNodeId: group.id,
        before: { skills: group.skills },
        after: { skills: [...group.skills, "Rust"] },
      },
    ])
    const next = added.resume.sections[3]?.items[0]
    if (next?.kind !== "skills") throw new Error("lost the group")
    expect(next.skills).toContain("Rust")

    const removed = strict(added.resume, [
      {
        ...meta,
        op: "update_fields",
        targetNodeId: group.id,
        before: { skills: next.skills },
        after: { skills: next.skills.filter((skill) => skill !== "Rust") },
      },
    ])
    const back = removed.resume.sections[3]?.items[0]
    if (back?.kind !== "skills") throw new Error("lost the group")
    expect(back.skills).toEqual(group.skills)
  })
})

describe("reach", () => {
  it("corrects an email address", () => {
    const result = strict(onePage, [
      {
        ...meta,
        op: "replace_text",
        targetNodeId: "basics",
        field: "email",
        before: onePage.basics.email ?? "",
        after: "mira@halvorsen.dev",
      },
    ])
    expect(result.resume.basics.email).toBe("mira@halvorsen.dev")
  })

  it("corrects a link URL", () => {
    const link = onePage.basics.links[0]
    if (!link) throw new Error("bad fixture")
    const result = strict(onePage, [
      {
        ...meta,
        op: "replace_text",
        targetNodeId: link.id,
        field: "url",
        before: link.url,
        after: "https://github.com/mirah-2",
      },
    ])
    expect(result.resume.basics.links[0]?.url).toBe(
      "https://github.com/mirah-2"
    )
  })
})

describe("the structural tier", () => {
  it("lets a bullet delete through without the flag", () => {
    const bullet = firstConcreteItem().bullets[0]
    if (!bullet) throw new Error("bad fixture")
    const { valid, rejected } = validatePatches(
      onePage,
      [{ ...meta, op: "delete", targetNodeId: bullet.id, before: bullet }],
      { allowStructural: false }
    )
    expect(rejected).toEqual([])
    expect(valid).toHaveLength(1)
  })

  it("refuses an item delete without the flag and allows it with the flag", () => {
    const item = firstConcreteItem()
    const patch: ResumePatch = {
      ...meta,
      op: "delete",
      targetNodeId: item.id,
      before: item,
    }

    expect(
      validatePatches(onePage, [patch], { allowStructural: false }).rejected[0]
        ?.code
    ).toBe("STRUCTURAL_NOT_REQUESTED")
    expect(
      validatePatches(onePage, [patch], { allowStructural: true }).valid
    ).toHaveLength(1)
  })

  it("names a section insert as structural", () => {
    const patch: ResumePatch = {
      ...meta,
      op: "insert_after",
      parentId: "root",
      afterNodeId: null,
      node: { type: "custom", title: "Speaking", items: [] },
    }
    const { rejected } = validatePatches(onePage, [patch], {
      allowStructural: false,
    })
    expect(rejected[0]?.code).toBe("STRUCTURAL_NOT_REQUESTED")
    expect(rejected[0]?.message).toBe("add a section")
  })

  it("lets a same-parent move through and refuses a cross-parent one", () => {
    const bullet = firstConcreteItem().bullets[0]
    if (!bullet) throw new Error("bad fixture")

    const reorder: ResumePatch = {
      ...meta,
      op: "move",
      targetNodeId: bullet.id,
      toIndex: 1,
    }
    expect(
      validatePatches(onePage, [reorder], { allowStructural: false }).valid
    ).toHaveLength(1)

    const crossing: ResumePatch = {
      ...meta,
      op: "move",
      targetNodeId: bullet.id,
      toIndex: 0,
      toParentId: secondConcreteItem().id,
    }
    expect(
      validatePatches(onePage, [crossing], { allowStructural: false })
        .rejected[0]?.code
    ).toBe("STRUCTURAL_NOT_REQUESTED")

    const moved = strict(onePage, [crossing])
    const destination = moved.resume.sections[0]?.items[1]
    if (destination?.kind !== "experience") throw new Error("bad fixture")
    expect(destination.bullets[0]?.id).toBe(bullet.id)

    const inverse = moved.applied[0]?.inverse
    if (inverse?.op !== "move") throw new Error("no inverse move")
    const back = strict(moved.resume, [inverse])
    expect(back.resume.sections[0]?.items[0]?.kind === "experience").toBe(true)
  })

  it("refuses a move into a container of the wrong kind", () => {
    const bullet = firstConcreteItem().bullets[0]
    if (!bullet) throw new Error("bad fixture")
    const { rejected } = validatePatches(
      onePage,
      [
        {
          ...meta,
          op: "move",
          targetNodeId: bullet.id,
          toIndex: 0,
          toParentId: section(0).id,
        },
      ],
      { allowStructural: true }
    )
    expect(rejected[0]?.code).toBe("KIND_MISMATCH")
  })

  it("refuses a cross-parent move past the end of the destination", () => {
    const bullet = firstConcreteItem().bullets[0]
    const destination = secondConcreteItem()
    if (!bullet) throw new Error("bad fixture")
    const { rejected } = validatePatches(
      onePage,
      [
        {
          ...meta,
          op: "move",
          targetNodeId: bullet.id,
          toIndex: destination.bullets.length + 1,
          toParentId: destination.id,
        },
      ],
      { allowStructural: true }
    )
    expect(rejected[0]?.code).toBe("INDEX_OUT_OF_RANGE")
  })
})

describe("the figures a patch adds", () => {
  const bullet = firstConcreteItem().bullets[0]
  if (!bullet) throw new Error("bad fixture")

  it("reports a figure the document does not state, unit included", () => {
    expect(
      addedFigures(onePage, {
        ...meta,
        op: "replace_text",
        targetNodeId: bullet.id,
        field: "text",
        before: bullet.text,
        after: "Owned 18 services and cut review time ~40%.",
      })
    ).toEqual(["18", "40%"])
  })

  it("stays quiet for a figure the source already states", () => {
    expect(
      addedFigures(onePage, {
        ...meta,
        op: "replace_text",
        targetNodeId: bullet.id,
        field: "text",
        before: bullet.text,
        after: "Cut reconciliation from 9 hours to 20 minutes.",
      })
    ).toEqual([])
  })

  it("reads a range as two figures and a thousands separator as one", () => {
    expect(
      addedFigures(onePage, {
        ...meta,
        op: "replace_text",
        targetNodeId: bullet.id,
        field: "text",
        before: bullet.text,
        after: "Managed 8-12 accounts, saving 1,200 hours.",
      })
    ).toEqual(["8", "12", "1,200"])
  })

  it("does not mistake identifiers for figures", () => {
    expect(
      addedFigures(onePage, {
        ...meta,
        op: "replace_text",
        targetNodeId: bullet.id,
        field: "text",
        before: bullet.text,
        after: "Deployed on EC2 and S3 for a 2x throughput gain.",
      })
    ).toEqual(["2x"])
  })

  it("walks a node a patch adds, skipping its ids", () => {
    expect(
      addedFigures(onePage, {
        ...meta,
        op: "insert_after",
        parentId: firstConcreteItem().id,
        afterNodeId: bullet.id,
        node: {
          id: "bul_12ab34cd56",
          text: "Grew the platform to 250+ teams.",
        },
      })
    ).toEqual(["250+"])
  })

  it("reads the entries of a skills group", () => {
    const group = section(3).items[0]
    if (group?.kind !== "skills") throw new Error("bad fixture")
    expect(
      addedFigures(onePage, {
        ...meta,
        op: "update_fields",
        targetNodeId: group.id,
        before: { skills: group.skills },
        after: {
          skills: [...group.skills, "AWS (EC2, S3)", "5 years of Go"],
        },
      })
    ).toEqual(["5"])
  })

  it("reports nothing for a patch that adds no text", () => {
    expect(
      addedFigures(onePage, {
        ...meta,
        op: "delete",
        targetNodeId: bullet.id,
        before: bullet,
      })
    ).toEqual([])
    expect(
      addedFigures(onePage, {
        ...meta,
        op: "move",
        targetNodeId: bullet.id,
        toIndex: 1,
      })
    ).toEqual([])
  })
})
