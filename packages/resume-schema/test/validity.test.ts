import { describe, expect, it } from "vitest"

import { documentErrors, type Resume } from "../src/index"
import { onePage } from "../src/fixtures/index"

function edit(mutate: (doc: Resume) => void): Resume {
  const doc: Resume = structuredClone(onePage)
  mutate(doc)
  return doc
}

function firstItem(doc: Resume) {
  const item = doc.sections[0]?.items[0]
  if (!item) throw new Error("fixture needs an item")
  return item
}

describe("documentErrors", () => {
  it("reports a whole document as savable with no field errors", () => {
    const validity = documentErrors(onePage)
    expect(validity.savable).toBe(true)
    expect(validity.byNode).toEqual({})
  })

  it("attributes a field error to the node holding the field", () => {
    const doc = edit((d) => {
      d.basics.name = ""
    })
    const validity = documentErrors(doc)
    expect(validity.savable).toBe(false)
    expect(Object.keys(validity.byNode)).toEqual(["basics"])
    expect(validity.byNode.basics?.name).toBeTruthy()
  })

  it("attributes an item's error to the item, not the section around it", () => {
    const doc = edit((d) => {
      const item = firstItem(d)
      if (item.kind !== "experience") throw new Error("expected experience")
      item.company = ""
    })
    const validity = documentErrors(doc)
    const itemId = firstItem(doc).id
    expect(Object.keys(validity.byNode)).toEqual([itemId])
    expect(validity.byNode[itemId]?.company).toBeTruthy()
  })

  it("attributes a bullet's error to the bullet, not the item above it", () => {
    const doc = edit((d) => {
      const item = firstItem(d)
      if (!("bullets" in item) || !item.bullets?.[0]) {
        throw new Error("fixture needs a bullet")
      }
      item.bullets[0].text = "x".repeat(2001)
    })
    const item = firstItem(doc)
    const bulletId = "bullets" in item ? item.bullets?.[0]?.id : undefined
    const validity = documentErrors(doc)
    expect(bulletId).toBeTruthy()
    expect(Object.keys(validity.byNode)).toEqual([bulletId])
  })

  it("keeps one message per field and reports every broken node", () => {
    const doc = edit((d) => {
      d.basics.name = ""
      d.basics.email = "not-an-email"
    })
    const validity = documentErrors(doc)
    expect(Object.keys(validity.byNode.basics ?? {}).sort()).toEqual([
      "email",
      "name",
    ])
  })

  it("blocks the save for a structural problem no field can show", () => {
    const doc = edit((d) => {
      d.basics.links.push({ id: "basics", label: "Site", url: "https://x.dev" })
    })
    const validity = documentErrors(doc)
    expect(validity.savable).toBe(false)
  })
})
