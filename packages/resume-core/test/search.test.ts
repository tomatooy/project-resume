import type { Resume } from "@workspace/resume-schema"
import { describe, expect, it } from "vitest"

import {
  HITS_PER_RESUME,
  MAX_SEARCH_RESULTS,
  makeSnippet,
  matchTokens,
  searchableFields,
  tokenize,
} from "../src/domain/search"
import { harness, only } from "./harness"

/**
 * One experience item and one skills group: enough for every field kind the
 * search reads, plus the chips and the extra item fields it reads on top.
 */
const base: Resume = {
  schemaVersion: 1,
  basics: {
    id: "basics",
    name: "Jo Rivera",
    headline: "Platform Engineer",
    email: "jo@example.com",
    phone: "+1 555 0100",
    location: "Berlin",
    summary: "Platform engineer who likes boring infrastructure.",
    links: [
      {
        id: "lnk_aaaaaaaaaa",
        label: "Portfolio",
        url: "https://jo.example.com",
      },
    ],
  },
  sections: [
    {
      id: "sec_aaaaaaaaaa",
      type: "experience",
      title: "Experience",
      items: [
        {
          id: "exp_aaaaaaaaaa",
          kind: "experience",
          company: "Globex",
          role: "Senior Engineer",
          location: "Remote",
          start: "2020-01",
          end: "present",
          bullets: [
            {
              id: "bul_aaaaaaaaaa",
              text: "Ran 12 kubernetes clusters in production.",
            },
            { id: "bul_bbbbbbbbbb", text: "Cut deploy time by 40%." },
          ],
        },
      ],
    },
    {
      id: "sec_bbbbbbbbbb",
      type: "skills",
      title: "Skills",
      items: [
        {
          id: "skl_aaaaaaaaaa",
          kind: "skills",
          label: "Languages",
          skills: ["TypeScript", "Helm"],
        },
      ],
    },
  ],
}

/** A resume whose whole content is the given bullets. */
function bulletsOnly(texts: string[]): Resume {
  return {
    schemaVersion: 1,
    basics: { id: "basics", name: "Jo Rivera", links: [] },
    sections: [
      {
        id: "sec_aaaaaaaaaa",
        type: "experience",
        title: "Experience",
        items: [
          {
            id: "exp_aaaaaaaaaa",
            kind: "experience",
            company: "Globex",
            role: "Engineer",
            start: "2020-01",
            end: "present",
            bullets: texts.map((text, index) => ({
              id: `bul_${String(index).padStart(10, "0")}`,
              text,
            })),
          },
        ],
      },
    ],
  }
}

describe("ResumeService.search", () => {
  it("ranks a title hit above a body hit", async () => {
    const { resumeService } = harness()
    const body = await resumeService.create({
      title: "Older, body only",
      document: base,
    })
    const titled = await resumeService.create({
      title: "Kubernetes Platform Lead",
      document: bulletsOnly(["Shipped the deploy pipeline."]),
    })

    const groups = (await resumeService.search("kubernetes")).groups

    expect(groups.map((group) => group.resume.id)).toEqual([titled.id, body.id])
    expect(only(groups).titleRanges.length).toBeGreaterThan(0)
    expect(only(groups, 1).titleRanges).toEqual([])
  })

  it("names where a body hit sits and highlights it inside the snippet", async () => {
    const { resumeService } = harness()
    await resumeService.create({ title: "Platform", document: base })

    const group = only((await resumeService.search("kubernetes")).groups)
    const hit = only(group.hits)

    expect(hit.breadcrumb).toBe("Experience > Globex > bullet 1")
    expect(group.totalHits).toBe(1)
    for (const [start, end] of hit.ranges) {
      expect(hit.snippet.slice(start, end)).toBe("kubernetes")
    }
  })

  it("treats a skills chip as its own hit", async () => {
    const { resumeService } = harness()
    await resumeService.create({ title: "Platform", document: base })

    const hit = only(only((await resumeService.search("helm")).groups).hits)

    expect(hit.breadcrumb).toBe("Skills > Languages")
    expect(hit.snippet).toBe("Helm")
    expect(only(hit.ranges)).toEqual([0, 4])
  })

  it("ignores section titles, dates, and the generated subtitle", async () => {
    const { resumeService } = harness()
    await resumeService.create({
      title: "Platform",
      subtitle: "Tailored for Acme",
      document: base,
    })

    for (const query of ["experience", "2020", "present", "tailored"]) {
      expect((await resumeService.search(query)).groups).toEqual([])
    }
    // The resume is reachable, so the empty results are the exclusions.
    expect((await resumeService.search("kubernetes")).groups).toHaveLength(1)
  })

  it("requires every token, anywhere in the document", async () => {
    const { resumeService } = harness()
    await resumeService.create({ title: "Platform", document: base })

    const both = only((await resumeService.search("kubernetes helm")).groups)

    expect(both.hits).toHaveLength(2)
    expect((await resumeService.search("kubernetes nomad")).groups).toEqual([])
  })

  it("matches case-insensitively", async () => {
    const { resumeService } = harness()
    const { id } = await resumeService.create({
      title: "Platform",
      document: base,
    })

    const lower = await resumeService.search("kubernetes")
    const upper = await resumeService.search("KUBERNETES")

    expect(upper.groups.map((group) => group.resume.id)).toEqual([id])
    expect(upper.groups).toEqual(lower.groups)
  })

  it("caps hits per resume and keeps the full count", async () => {
    const { resumeService } = harness()
    await resumeService.create({
      title: "Platform",
      document: bulletsOnly(
        Array.from({ length: 7 }, (_, i) => `kubernetes cluster ${i}`)
      ),
    })

    const group = only((await resumeService.search("kubernetes")).groups)

    expect(group.hits).toHaveLength(HITS_PER_RESUME)
    expect(group.totalHits).toBe(7)
  })

  it("orders hits by document order and a tier by recency", async () => {
    const { resumeService } = harness()
    const doc = bulletsOnly(["kubernetes platform"])
    doc.sections.push({
      id: "sec_bbbbbbbbbb",
      type: "skills",
      title: "Skills",
      items: [
        {
          id: "skl_aaaaaaaaaa",
          kind: "skills",
          label: "Infra",
          skills: ["Kubernetes", "Helm"],
        },
      ],
    })

    const older = await resumeService.create({ title: "Older", document: doc })
    const newer = await resumeService.create({
      title: "Newer",
      document: bulletsOnly(["kubernetes platform"]),
    })

    const groups = (await resumeService.search("kubernetes")).groups

    expect(groups.map((group) => group.resume.id)).toEqual([newer.id, older.id])
    expect(only(groups, 1).hits.map((hit) => hit.breadcrumb)).toEqual([
      "Experience > Globex > bullet 1",
      "Skills > Infra",
    ])
  })

  it("caps the result list and reports how many resumes it read", async () => {
    const { resumeService } = harness()
    const matching = MAX_SEARCH_RESULTS + 2
    for (let index = 0; index < matching; index += 1) {
      await resumeService.create({
        title: `Resume ${index}`,
        document: bulletsOnly(["kubernetes platform"]),
      })
    }
    await resumeService.create({
      title: "Miss",
      document: bulletsOnly(["nomad platform"]),
    })

    const result = await resumeService.search("kubernetes")

    expect(result.groups).toHaveLength(MAX_SEARCH_RESULTS)
    expect(result.scanned).toBe(matching + 1)
  })

  it("returns nothing, without reading, for a query under two characters", async () => {
    const { resumeService } = harness()
    await resumeService.create({ title: "Platform", document: base })

    for (const query of ["", " ", "a", " a "]) {
      expect(await resumeService.search(query)).toEqual({
        groups: [],
        scanned: 0,
      })
    }
  })

  it("drops a soft-deleted resume", async () => {
    const { resumeService } = harness()
    const { id } = await resumeService.create({
      title: "Platform",
      document: base,
    })

    await resumeService.remove(id)

    expect(await resumeService.search("kubernetes")).toEqual({
      groups: [],
      scanned: 0,
    })
  })

  it("sees an edit made after creation", async () => {
    const { resumeService } = harness()
    const { id } = await resumeService.create({
      title: "Platform",
      document: base,
    })
    const record = await resumeService.get(id)

    await resumeService.update({
      id,
      data: bulletsOnly(["Ran 12 nomad clusters in production."]),
      expectedRevision: record.revision,
    })

    expect((await resumeService.search("kubernetes")).groups).toEqual([])
    expect((await resumeService.search("nomad")).groups).toHaveLength(1)
  })
})

describe("searchableFields", () => {
  it("walks document order and splits a skills group into chips", () => {
    const fields = searchableFields(base)
    const texts = fields.map((field) => field.text)

    expect(only(fields).text).toBe("Platform Engineer")
    expect(
      fields.filter((field) => field.field === "skills").map((f) => f.text)
    ).toEqual(["TypeScript", "Helm"])
    expect(texts.indexOf("TypeScript")).toBeGreaterThan(
      texts.indexOf("Ran 12 kubernetes clusters in production.")
    )
  })

  it("reads the item fields no patch may rewrite, and no structural ones", () => {
    const texts = searchableFields(base).map((field) => field.text)

    expect(texts).toContain("Remote")
    expect(texts).not.toContain("Experience")
    expect(texts).not.toContain("2020-01")
    expect(texts).not.toContain("present")
  })
})

describe("matchTokens", () => {
  it("merges runs that touch or overlap", () => {
    expect(matchTokens("abcabc", ["abc"])).toEqual([[0, 6]])
    expect(matchTokens("kubernetespod", ["kubernetes", "netes"])).toEqual([
      [0, 10],
    ])
  })

  it("is case-insensitive and empty when nothing matches", () => {
    expect(matchTokens("Kubernetes", ["kubernetes"])).toEqual([[0, 10]])
    expect(matchTokens("kubernetes", ["nomad"])).toEqual([])
    expect(matchTokens("", ["kubernetes"])).toEqual([])
  })
})

describe("makeSnippet", () => {
  it("keeps a short field as it is", () => {
    const text = "Ran 12 kubernetes clusters in production."
    const snippet = makeSnippet(text, matchTokens(text, ["kubernetes"]))

    expect(snippet.snippet).toBe(text)
    expect(snippet.ranges).toEqual([[7, 17]])
  })

  it("marks the cut on both sides and shifts the hit", () => {
    const text = `${"a".repeat(80)} kubernetes ${"b".repeat(80)}`
    const { snippet, ranges } = makeSnippet(
      text,
      matchTokens(text, ["kubernetes"])
    )
    const [start, end] = only(ranges)

    expect(snippet.startsWith("...")).toBe(true)
    expect(snippet.endsWith("...")).toBe(true)
    expect(snippet.slice(start, end)).toBe("kubernetes")
  })

  it("shifts every hit that lands inside the window", () => {
    const text = "kubernetes and helm charts"
    const { snippet, ranges } = makeSnippet(
      text,
      matchTokens(text, ["kubernetes", "helm"])
    )

    expect(ranges).toHaveLength(2)
    for (const [start, end] of ranges) {
      expect(["kubernetes", "helm"]).toContain(snippet.slice(start, end))
    }
  })

  it("clips a hit that runs past the window end", () => {
    const long = "n".repeat(50)
    const text = `kubernetes${"x".repeat(10)}${long}`
    const { ranges } = makeSnippet(
      text,
      matchTokens(text, ["kubernetes", long])
    )
    const [start, end] = only(ranges, 1)

    // 20 is where the long run starts; the window ends at 10 + 44.
    expect([start, end]).toEqual([20, 54])
  })
})

describe("tokenize", () => {
  it("trims, splits, lowercases, and dedupes", () => {
    expect(tokenize("  Kubernetes   kubernetes  Helm ")).toEqual([
      "kubernetes",
      "helm",
    ])
    expect(tokenize("   ")).toEqual([])
  })
})
