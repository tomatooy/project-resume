import type { Resume } from "@workspace/resume-schema"
import { fid, minimal, onePage } from "@workspace/resume-schema/fixtures"
import { describe, expect, it } from "vitest"

import { type AiJob, applicantContext, type Json } from "../src/context"
import { sampleProfile } from "../src/fixtures"

/** One property of a JSON object, or undefined. */
function prop(json: Json, key: string): Json | undefined {
  return json !== null && typeof json === "object" && !Array.isArray(json)
    ? json[key]
    : undefined
}

const input = {
  profile: sampleProfile,
  resume: onePage,
  notes: "## Logistics\n- Lives in SF.",
  job: null,
  page: { company: "Acme", title: "Backend Engineer" },
  today: new Date(2026, 9, 18),
}

const job: AiJob = {
  company: "Acme",
  title: "Backend Engineer",
  requirements: {
    mustHaves: ["Go"],
    niceToHaves: ["Kafka"],
    keywords: ["ledger"],
  },
  description: "d".repeat(9_000),
}

describe("applicantContext", () => {
  it("keeps EEO and salary out of AI context", () => {
    const json = JSON.stringify(
      applicantContext({
        profile: {
          ...sampleProfile,
          preferences: { ...sampleProfile.preferences, salaryMin: 150000 },
        },
        resume: onePage,
        notes: "",
        job: null,
        page: { company: null, title: null },
        today: new Date(2026, 9, 18),
      })
    )
    expect(json).not.toMatch(/eeo|salary|150000|decline/i)
  })

  it("keeps the other preferences without the salary currency or period", () => {
    const context = applicantContext({
      ...input,
      profile: {
        ...sampleProfile,
        preferences: {
          ...sampleProfile.preferences,
          currency: "EUR",
          salaryPeriod: "hour",
          relocation: "yes",
          cities: ["Austin"],
        },
      },
    })
    expect(context).toHaveProperty(["profile", "preferences"], {
      startKind: null,
      startDate: "",
      noticeWeeks: null,
      relocation: "yes",
      workModes: [],
      cities: ["Austin"],
    })
  })

  it("passes the rest of the Profile, Notes, page and date", () => {
    expect(applicantContext(input)).toMatchObject({
      today: "2026-10-18",
      profile: {
        personal: sampleProfile.personal,
        contact: sampleProfile.contact,
        links: sampleProfile.links,
        workAuth: sampleProfile.workAuth,
        other: sampleProfile.other,
      },
      notes: "## Logistics\n- Lives in SF.",
      job: null,
      page: { company: "Acme", title: "Backend Engineer" },
    })
  })

  it("gives each kind of resume item without node ids", () => {
    const context = applicantContext(input)
    expect(context).toHaveProperty(
      ["resume", "basics", "links"],
      [
        { label: "github.com/mirah", url: "https://github.com/mirah" },
        { label: "LinkedIn", url: "https://linkedin.com/in/mirah" },
      ]
    )
    expect(context).toHaveProperty(["resume", "sections", 0, "items", 1], {
      company: "Schibsted",
      role: "Backend Engineer",
      location: "Oslo",
      start: "2019-08",
      end: "2022-02",
      bullets: [
        "Owned the subscription billing service through a migration from monolith to service, with no customer-visible downtime.",
        "Cut p99 checkout latency from 1.8s to 420ms by moving price resolution off the request path.",
      ],
    })
    expect(context).toHaveProperty(["resume", "sections", 1, "items", 0], {
      name: "ledgerkit",
      url: "https://github.com/mirah/ledgerkit",
      start: "2021-04",
      bullets: [
        "Double-entry accounting primitives for Postgres, used by 4 companies in production.",
      ],
    })
    expect(context).toHaveProperty(["resume", "sections", 2, "items", 0], {
      school: "NTNU",
      degree: "MSc",
      field: "Computer Science",
      start: "2014-08",
      end: "2019-06",
      bullets: [],
    })
    expect(context).toHaveProperty(["resume", "sections", 3, "items", 0], {
      label: "Languages",
      skills: ["Go", "TypeScript", "SQL", "Kotlin"],
    })
    expect(JSON.stringify(context)).not.toMatch(/"id"|"kind"|(lnk|exp|bul)_/)
  })

  it("leaves out what a resume node does not have", () => {
    const talks: Resume = {
      ...minimal,
      sections: [
        {
          id: fid("sec", "talks"),
          type: "custom",
          title: "Talks",
          items: [
            {
              id: fid("cus", "talk"),
              kind: "custom",
              title: "Ledgers at scale",
              subtitle: "GopherCon",
              start: "2024-05",
              bullets: [],
            },
          ],
        },
      ],
    }
    // Strict, so a property set to undefined fails too.
    expect(
      prop(applicantContext({ ...input, resume: talks }), "resume")
    ).toStrictEqual({
      basics: { name: "Dana Okonjo", email: "dana@okonjo.dev", links: [] },
      sections: [
        {
          title: "Talks",
          type: "custom",
          items: [
            {
              title: "Ledgers at scale",
              subtitle: "GopherCon",
              start: "2024-05",
              bullets: [],
            },
          ],
        },
      ],
    })
  })

  it("has no resume when none is chosen", () => {
    expect(applicantContext({ ...input, resume: null })).toHaveProperty(
      "resume",
      null
    )
  })

  it("cuts the job description to 8,000 characters", () => {
    expect(applicantContext({ ...input, job })).toHaveProperty("job", {
      ...job,
      description: "d".repeat(8_000),
    })
  })
})
