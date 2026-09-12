import { ResumeSchema, type Resume } from "@workspace/resume-schema"
import { describe, expect, it } from "vitest"

import { preflightChecks, preflightWarnCount } from "./preflight-checks"

/**
 * The checks are the one place the export screen and the status bar agree
 * about what is wrong with a document, so each rule gets a test as the rule
 * rather than as text the panel happens to render.
 */

type Section = Resume["sections"][number]

const SECTION_ID = "sec_aaaaaaaaaa"
const ITEM_ID = "exp_aaaaaaaaaa"

function doc(
  options: {
    email?: string
    bullets?: string[]
    extraSections?: Section[]
  } = {}
): Resume {
  const bullets = options.bullets ?? ["Shipped 3 things"]
  return {
    schemaVersion: 1,
    basics: {
      id: "basics",
      name: "Jo Rivera",
      ...(options.email === undefined ? { email: "jo@example.com" } : {}),
      links: [],
    },
    sections: [
      {
        id: SECTION_ID,
        type: "experience",
        title: "Experience",
        items: [
          {
            id: ITEM_ID,
            kind: "experience",
            company: "Acme",
            role: "Engineer",
            start: "2020-01",
            end: "present",
            bullets: bullets.map((text, i) => ({
              id: `bul_aaaaaaaaa${i}`,
              text,
            })),
          },
        ],
      },
      ...(options.extraSections ?? []),
    ],
  }
}

type Input = Parameters<typeof preflightChecks>[0]

function checks(overrides: Partial<Input> = {}) {
  return preflightChecks({
    doc: doc(),
    templateId: "lisbon",
    pageCount: 1,
    error: null,
    ...overrides,
  })
}

function warnTitles(overrides: Partial<Input> = {}): string[] {
  return checks(overrides)
    .filter((check) => check.level === "warn")
    .map((check) => check.title)
}

function titles(overrides: Partial<Input> = {}): string[] {
  return checks(overrides).map((check) => check.title)
}

describe("preflightChecks", () => {
  it("clears a one-page resume with a figure in every bullet", () => {
    expect(ResumeSchema.safeParse(doc()).success).toBe(true)
    expect(preflightWarnCount(checks())).toBe(0)
  })

  it("counts the bullets with no figure and pluralizes them", () => {
    expect(warnTitles({ doc: doc({ bullets: ["Grew the team"] }) })).toContain(
      "1 bullet without a number"
    )
    expect(
      warnTitles({
        doc: doc({ bullets: ["Grew the team", "Owned the roadmap"] }),
      })
    ).toContain("2 bullets without a number")
  })

  it("treats a blank bullet as nothing to measure", () => {
    const blank = checks({ doc: doc({ bullets: ["  "] }) })
    expect(blank.filter((check) => check.level === "warn")).toEqual([])
    expect(blank.map((check) => check.title)).toContain(
      "Every bullet carries a figure"
    )
  })

  it("asks for an email only when there is none", () => {
    expect(warnTitles()).not.toContain("No email address")
    expect(warnTitles({ doc: doc({ email: "" }) })).toContain(
      "No email address"
    )
  })

  it("holds two pages and warns past them", () => {
    expect(preflightWarnCount(checks({ pageCount: 2 }))).toBe(0)
    expect(warnTitles({ pageCount: 3 })).toContain(
      "3 pages at the current settings"
    )
  })

  it("warns while the page count is not measured", () => {
    expect(warnTitles({ pageCount: null })).toContain(
      "Page count not measured yet"
    )
  })

  it("names the empty sections", () => {
    const empty: Section = {
      id: "sec_bbbbbbbbbb",
      type: "projects",
      title: "Projects",
      items: [],
    }
    expect(warnTitles({ doc: doc({ extraSections: [empty] }) })).toContain(
      "1 empty section"
    )
  })

  it("warns about a two-column template and not a single-column one", () => {
    expect(warnTitles({ templateId: "meridian" })).toContain(
      "Two-column layout"
    )
    expect(warnTitles({ templateId: "meridian" })).not.toContain(
      "Single-column layout"
    )
    expect(titles({ templateId: "lisbon" })).toContain("Single-column layout")
    expect(warnTitles({ templateId: "lisbon" })).not.toContain(
      "Two-column layout"
    )
  })

  it("passes a failed render through with its message", () => {
    const failed = checks({ error: "Font not found" })
    expect(preflightWarnCount(failed)).toBe(1)
    expect(failed.find((check) => check.level === "warn")?.detail).toBe(
      "Font not found"
    )
  })

  it("counts only the checks that want attention", () => {
    const all = checks({ pageCount: null })
    expect(preflightWarnCount(all)).toBe(1)
    expect(all.length).toBeGreaterThan(1)
  })
})
