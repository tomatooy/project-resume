import { describe, expect, it } from "vitest"

import { assembleResume, type ParsedResume, type Resume } from "../src/index"

/** The name each skills group ended up with, in document order. */
function groupLabels(resume: Resume): string[] {
  return resume.sections
    .filter((section) => section.type === "skills")
    .flatMap((section) => section.items)
    .map((item) => (item.kind === "skills" ? item.label : item.kind))
}

/** A document whose heading says nothing about what any group holds. */
const PARSED: ParsedResume = {
  basics: { name: "Ada" },
  sections: [
    {
      type: "skills",
      title: "TECHNICAL SKILLS",
      items: [
        { label: "Languages", skills: ["TypeScript", "Python"] },
        { title: "Frameworks", skills: ["React"] },
      ],
    },
  ],
}

describe("assembleResume", () => {
  it("keeps a skills group's own name, from `label` or `title`", () => {
    expect(groupLabels(assembleResume(PARSED))).toEqual([
      "Languages",
      "Frameworks",
    ])
  })

  it("does not name an unnamed group after the section heading", () => {
    const resume = assembleResume({
      basics: { name: "Ada" },
      sections: [
        {
          type: "skills",
          title: "TECHNICAL SKILLS",
          items: [{ skills: ["TypeScript"] }, { skills: ["React"] }],
        },
      ],
    })

    expect(groupLabels(resume)).toEqual(["Skills", "Skills"])
  })
})
