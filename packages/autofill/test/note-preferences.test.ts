import { describe, expect, it } from "vitest"

import { matchNotePreferences } from "../src/note-preferences"

const note =
  "- For source of job opportunity, select in fallback order The Company's website -> linkedin -> job board."

describe("matchNotePreferences", () => {
  it("uses Notes order before page order and matches a source inside a broader option", () => {
    expect(
      matchNotePreferences(`## Companies\n${note}`, [
        "Job board",
        "Social media (LinkedIn, Instagram, X etc)",
      ])
    ).toEqual([
      {
        note,
        preference: "linkedin",
        option: "Social media (LinkedIn, Instagram, X etc)",
      },
    ])
  })

  it("uses the earlier company website when available", () => {
    expect(
      matchNotePreferences(note, [
        "Job board",
        "LinkedIn",
        "The Company's website",
      ])
    ).toEqual([
      {
        note,
        preference: "The Company's website",
        option: "The Company's website",
      },
    ])
  })

  it("uses the last available fallback", () => {
    expect(matchNotePreferences(note, ["Referral", "Job board"])).toEqual([
      { note, preference: "job board", option: "Job board" },
    ])
  })

  it("does not interpret arrows in facts or use unavailable preferences", () => {
    expect(
      matchNotePreferences("- Career: intern -> engineer.", ["engineer"])
    ).toEqual([])
    expect(matchNotePreferences(note, ["Referral"])).toEqual([])
  })

  it("leaves an ambiguous earlier preference for the model instead of skipping it", () => {
    expect(
      matchNotePreferences(note, [
        "LinkedIn jobs",
        "LinkedIn message",
        "Job board",
      ])
    ).toEqual([])
  })
})
