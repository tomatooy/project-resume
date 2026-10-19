import { emptyProfile } from "@workspace/autofill"
import { describe, expect, it } from "vitest"

import {
  chooseRace,
  joinPhone,
  profileIssues,
  splitPhone,
} from "./profile-fields"

describe("splitPhone", () => {
  it("reads the country code off a stored number", () => {
    expect(splitPhone("+14155550100")).toEqual({
      code: "+1",
      national: "4155550100",
    })
    expect(splitPhone("+442079460958")).toEqual({
      code: "+44",
      national: "2079460958",
    })
    expect(splitPhone("+85221234567")).toEqual({
      code: "+852",
      national: "21234567",
    })
  })

  it("starts an empty number at +1", () => {
    expect(splitPhone("")).toEqual({ code: "+1", national: "" })
  })

  it("keeps a number with an unlisted code whole", () => {
    expect(splitPhone("+3592123456")).toEqual({
      code: "+",
      national: "3592123456",
    })
  })
})

describe("joinPhone", () => {
  it("stores the digits after the code as E.164", () => {
    expect(joinPhone("+1", "(415) 555-0100")).toBe("+14155550100")
  })

  it("stores nothing without a number", () => {
    expect(joinPhone("+44", "")).toBe("")
    expect(joinPhone("+44", " - ")).toBe("")
  })

  it("takes the code from the number under Other", () => {
    expect(joinPhone("+", "359 2 123 456")).toBe("+3592123456")
  })
})

describe("chooseRace", () => {
  it("drops Decline when a category is chosen", () => {
    expect(chooseRace(["decline"], "asian", true)).toEqual(["asian"])
  })

  it("adds a category to the others", () => {
    expect(chooseRace(["asian"], "white", true)).toEqual(["asian", "white"])
  })

  it("clears the categories when Decline is chosen", () => {
    expect(chooseRace(["asian", "white"], "decline", true)).toEqual(["decline"])
  })

  it("keeps the other categories when one is cleared", () => {
    expect(chooseRace(["asian", "white"], "asian", false)).toEqual(["white"])
  })

  it("falls back to Decline when nothing is left", () => {
    expect(chooseRace(["asian"], "asian", false)).toEqual(["decline"])
    expect(chooseRace(["decline"], "decline", false)).toEqual(["decline"])
  })
})

describe("profileIssues", () => {
  it("names each field the schema rejects by its path", () => {
    const profile = {
      ...emptyProfile,
      contact: { ...emptyProfile.contact, email: "ada@", zip: "9410" },
      links: {
        ...emptyProfile.links,
        other: [{ label: "", url: "https://blog.example" }],
      },
    }

    expect([...profileIssues(profile)].sort()).toEqual([
      "contact.email",
      "contact.zip",
      "links.other.0.label",
    ])
  })

  it("finds nothing wrong with the empty profile", () => {
    expect(profileIssues(emptyProfile).size).toBe(0)
  })
})
