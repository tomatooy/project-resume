import { describe, expect, it } from "vitest"

import {
  matchNumberRange,
  normalizeText,
  pickOption,
  pickYesNo,
  searchMatch,
  similarity,
} from "../src/match"

function opts(labels: string[]) {
  return labels.map((label) => ({ label }))
}

describe("normalizeText", () => {
  it("normalizes accents, case and punctuation", () => {
    expect(normalizeText("  Résumé/CV ")).toBe("resume cv")
  })
})

describe("pickOption", () => {
  it("picks exact options before unique prefixes", () => {
    expect(pickOption(opts(["Yes", "No"]), ["no"])).toBe(1)
    expect(
      pickOption(opts(["Canada +1", "United States +1"]), ["United States"])
    ).toBe(1)
    expect(
      pickOption(
        opts(["United States", "United States Minor Outlying Islands"]),
        ["United States"]
      )
    ).toBe(0)
    expect(pickOption(opts(["Yes, now", "Yes, later"]), ["Yes"])).toBeNull()
  })

  it("tries the next candidate when one matches nothing", () => {
    const options = opts(["Male", "Female", "Decline to self-identify"])
    expect(pickOption(options, ["I don't wish to answer", "Decline"])).toBe(2)
  })
})

describe("pickYesNo", () => {
  it("picks the option that answers yes or no", () => {
    expect(pickYesNo(opts(["Yes", "No"]), "no")).toBe(1)
    expect(pickYesNo(opts(["Yes, I am", "No, I am not"]), "yes")).toBe(0)
  })
})

describe("similarity", () => {
  it("scores equal text 1 and text with no shared pairs 0", () => {
    expect(similarity("Berkeley", "berkeley")).toBe(1)
    expect(similarity("a", "A")).toBe(1)
    expect(similarity("abc", "xyz")).toBe(0)
  })
})

describe("searchMatch", () => {
  it("matches location search results", () => {
    expect(
      searchMatch("San Francisco, CA", [
        "San Francisco, California, United States",
        "South San Francisco, California, United States",
      ])
    ).toBe(0)
    expect(
      searchMatch("Springfield, IL", ["Springfield, Missouri, United States"])
    ).toBeNull()
  })

  it("falls back to the one close label", () => {
    const target = "Massachusets Institute of Technology"
    expect(
      searchMatch(target, [
        "Georgia Institute of Technology",
        "Massachusetts Institute of Technology",
      ])
    ).toBe(1)
    expect(
      searchMatch(target, [
        "Massachusetts Institute of Technology",
        "Massachusetts Institute of Technology (MIT)",
      ])
    ).toBeNull()
  })
})

describe("matchNumberRange", () => {
  it("matches numbers to ranges", () => {
    const labels = ["Less than 1 year", "1-2 years", "3-5 years", "5+ years"]
    expect([0, 4, 7].map((n) => matchNumberRange(n, labels))).toEqual([0, 2, 3])
  })

  it("reads en dash ranges and open ranges written as words", () => {
    const labels = ["0–2 years", "3–5 years", "6 or more years"]
    expect([3, 8].map((n) => matchNumberRange(n, labels))).toEqual([1, 2])
  })
})
