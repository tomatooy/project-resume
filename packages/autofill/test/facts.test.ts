import type { Item, Resume } from "@workspace/resume-schema"
import { fid, minimal, onePage } from "@workspace/resume-schema/fixtures"
import { describe, expect, it } from "vitest"

import { resumeFacts } from "../src/facts"

const today = new Date(2026, 9, 18)

/** A resume holding only experience items, one per `[start, end]`. */
function withJobs(jobs: [string, string][]): Resume {
  return {
    ...minimal,
    sections: [
      {
        id: fid("sec", "exp"),
        type: "experience",
        title: "Experience",
        items: jobs.map(
          ([start, end], i): Item => ({
            id: fid("exp", `job${i}`),
            kind: "experience",
            company: `Company ${i}`,
            role: "Engineer",
            start,
            end,
            bullets: [],
          })
        ),
      },
    ],
  }
}

describe("resumeFacts", () => {
  it("derives facts from the resume", () => {
    const facts = resumeFacts(onePage, today)
    expect(facts).toMatchObject({
      company: "Vipps MobilePay",
      title: "Senior Backend Engineer",
      school: "NTNU",
      degree: "MSc",
      major: "Computer Science",
      graduation: "2019-06",
      years: 7,
    })
    expect(facts.skills).toContain("Go, TypeScript, SQL, Kotlin")
  })

  it("joins every skill group in order", () => {
    expect(resumeFacts(onePage, today).skills).toBe(
      "Go, TypeScript, SQL, Kotlin, Postgres, Kafka, Kubernetes, Terraform, OpenTelemetry"
    )
  })

  it.each<[string, [string, string][], number]>([
    [
      "overlapping jobs once",
      [
        ["2020-01", "2021-12"],
        ["2021-01", "2022-12"],
      ],
      3,
    ],
    [
      "no gap between jobs",
      [
        ["2018-01", "2018-12"],
        ["2020-01", "2020-12"],
      ],
      2,
    ],
    ["whole years, floored", [["2020-01", "2021-11"]], 1],
    ["a current job up to this month", [["2025-01", "present"]], 1],
    ["no months after today", [["2024-01", "2030-12"]], 2],
  ])("counts %s", (_, jobs, years) => {
    expect(resumeFacts(withJobs(jobs), today).years).toBe(years)
  })

  it("has no facts for sections the resume lacks", () => {
    expect(resumeFacts(minimal, today)).toEqual({
      company: null,
      title: null,
      school: null,
      degree: null,
      major: null,
      graduation: null,
      years: null,
      skills: null,
    })
  })

  it("has no graduation while the degree is in progress", () => {
    const studying: Resume = {
      ...minimal,
      sections: [
        {
          id: fid("sec", "edu"),
          type: "education",
          title: "Education",
          items: [
            {
              id: fid("edu", "mit"),
              kind: "education",
              school: "MIT",
              start: "2024-09",
              end: "present",
              bullets: [],
            },
          ],
        },
      ],
    }
    expect(resumeFacts(studying, today)).toMatchObject({
      school: "MIT",
      degree: null,
      major: null,
      graduation: null,
    })
  })
})
