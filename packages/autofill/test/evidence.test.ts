import { describe, expect, it } from "vitest"
import { applicantEvidence, relevantEvidence } from "../src/evidence"

describe("applicant evidence", () => {
  it("preserves company scope, negative statements and sibling facts when narrowing Notes", () => {
    const evidence = applicantEvidence({
      notes:
        "# Quora\n## Availability\n- Available 9am-3pm Pacific.\n- Not available Fridays.\n# Interviews\n- Prefers Java.",
    })
    const selected = relevantEvidence(evidence.notes, {
      label: "Availability during Quora coordination hours?",
    })
    expect(selected).toHaveLength(1)
    expect(selected[0]?.value).toContain("# Quora")
    expect(selected[0]?.value).toContain("Not available Fridays")
  })

  it("keeps job dates, role and bullets together without importing target job data", () => {
    const facts = applicantEvidence({
      resume: {
        sections: [
          {
            type: "experience",
            title: "Experience",
            items: [
              {
                role: "Intern",
                company: "Example",
                start: "2023-01",
                end: "2023-03",
                bullets: [
                  "Used Terraform, never managed production deployments.",
                ],
              },
            ],
          },
        ],
      },
      job: { description: "DISTRACTION" },
    })
    expect(facts.resume[0]?.value).toMatchObject({
      role: "Intern",
      start: "2023-01",
      end: "2023-03",
      bullets: ["Used Terraform, never managed production deployments."],
    })
    expect(JSON.stringify(facts)).not.toContain("DISTRACTION")
  })

  it("selects education for a degree field and retains all evidence for an unfamiliar question", () => {
    const facts = applicantEvidence({
      resume: {
        sections: [
          {
            type: "education",
            items: [
              {
                degree: "Master of Science",
                field: "Computer Science",
                end: "2024-12",
              },
            ],
          },
          {
            type: "experience",
            items: [{ company: "Example", role: "Developer" }],
          },
        ],
      },
    }).resume
    expect(relevantEvidence(facts, { label: "Degree" })).toHaveLength(1)
    expect(relevantEvidence(facts, { label: "Unrecognized topic" })).toEqual(
      facts
    )
  })
})
