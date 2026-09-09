import type { Resume } from "@workspace/resume-schema"
import { describe, expect, it } from "vitest"

import { enforceTailorRules } from "../src/domain/tailor"

function experience(company: string, role: string, start: string) {
  return {
    id: `exp_${company}${start}`,
    kind: "experience" as const,
    company,
    role,
    start,
    end: "present" as const,
    bullets: [{ id: `bul_${company}`, text: `Worked at ${company}.` }],
  }
}

function doc(items: ReturnType<typeof experience>[]): Resume {
  return {
    schemaVersion: 1,
    basics: { id: "basics", name: "Ada", links: [] },
    sections: [
      { id: "sec_exp", type: "experience", title: "Experience", items },
    ],
  }
}

describe("enforceTailorRules", () => {
  it("puts back an experience item the model dropped", () => {
    const source = doc([
      experience("Acme", "Engineer", "2020-01"),
      experience("Babbage", "Analyst", "1842-01"),
    ])
    const tailored = doc([experience("Acme", "Engineer", "2020-01")])

    const result = enforceTailorRules(source, tailored)

    const companies = result.sections[0]?.items.map(
      (item) => item.kind === "experience" && item.company
    )
    expect(companies).toEqual(["Acme", "Babbage"])
  })

  it("keeps the model's rewrite and ordering for the items it kept", () => {
    const source = doc([
      experience("Acme", "Engineer", "2020-01"),
      experience("Babbage", "Analyst", "1842-01"),
    ])
    const tailored = doc([
      experience("Babbage", "Analyst", "1842-01"),
      experience("Acme", "Engineer", "2020-01"),
    ])

    const result = enforceTailorRules(source, tailored)

    expect(result.sections[0]?.items).toEqual(tailored.sections[0]?.items)
  })

  it("puts back a whole experience section the model omitted", () => {
    const source = doc([experience("Acme", "Engineer", "2020-01")])
    const tailored: Resume = {
      schemaVersion: 1,
      basics: { id: "basics", name: "Ada", links: [] },
      sections: [
        {
          id: "sec_sk",
          type: "skills",
          title: "Skills",
          items: [
            {
              id: "skl_1",
              kind: "skills",
              label: "Languages",
              skills: ["TypeScript"],
            },
          ],
        },
      ],
    }

    const result = enforceTailorRules(source, tailored)

    expect(result.sections.map((s) => s.type)).toEqual(["skills", "experience"])
  })

  it("drops a section the model emptied", () => {
    const source = doc([experience("Acme", "Engineer", "2020-01")])
    const tailored: Resume = {
      schemaVersion: 1,
      basics: { id: "basics", name: "Ada", links: [] },
      sections: [
        ...doc([experience("Acme", "Engineer", "2020-01")]).sections,
        { id: "sec_pr", type: "projects", title: "Projects", items: [] },
      ],
    }

    const result = enforceTailorRules(source, tailored)

    expect(result.sections.map((s) => s.type)).toEqual(["experience"])
  })

  it("leaves a document that already obeys both rules untouched", () => {
    const source = doc([experience("Acme", "Engineer", "2020-01")])
    expect(enforceTailorRules(source, source)).toEqual(source)
  })
})
