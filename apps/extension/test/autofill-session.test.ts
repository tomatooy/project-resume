import type {
  FieldDescriptor,
  Fill,
  Question,
} from "@workspace/autofill/fields"
import type { PlanResult } from "@workspace/resume-core/contracts"
import { describe, expect, it } from "vitest"
import {
  type AutofillSession,
  applyScan,
  fieldsToFill,
  openQuestions,
  type ScanMessage,
} from "../src/background/autofill/session"
import { autofillView } from "../src/background/autofill/view"

const NOW = 1_000_000
const PICKED = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"

const field = (id: string, hasValue = false): FieldDescriptor => ({
  id,
  label: `Label ${id}`,
  control: "text",
  required: false,
  hasValue,
})

function sessionWith(fields: FieldDescriptor[]): AutofillSession {
  const scan: ScanMessage = {
    type: "autofill-scan",
    url: "https://job-boards.greenhouse.io/acme/jobs/1",
    postingKey: "greenhouse:acme:1",
    page: { company: "Acme", companyWeak: false, title: "Engineer" },
    form: true,
    formLink: null,
    fields,
  }
  const frame = {
    documentId: "doc-1",
    frameId: 0,
    vendor: "greenhouse" as const,
  }
  return applyScan(null, scan, frame, NOW).session
}

const question = (
  id: string,
  fieldId: string,
  companySpecific: boolean
): Question => ({
  id,
  text: `Question ${id}`,
  original: [{ fieldId, label: `Label ${fieldId}` }],
  companySpecific,
})

const plan = (overrides: Partial<PlanResult>): PlanResult => ({
  resumeId: null,
  resumeChoice: null,
  job: null,
  jobMatch: "none",
  fills: [],
  overwrites: [],
  classes: [],
  earlier: null,
  missing: [],
  quota: { remaining: 10, resetAt: null },
  ...overrides,
})

describe("openQuestions", () => {
  it("puts company questions last and keeps the order within each kind", () => {
    const session = {
      ...sessionWith([field("a"), field("b"), field("c")]),
      questions: [
        question("q1", "a", true),
        question("q2", "b", false),
        question("q3", "c", false),
      ],
    }
    expect(openQuestions(session).map(({ id }) => id)).toEqual([
      "q2",
      "q3",
      "q1",
    ])
  })

  it("drops a question once every field it asks about has a value", () => {
    const session = {
      ...sessionWith([field("a", true), field("b")]),
      questions: [question("q1", "a", false), question("q2", "b", false)],
    }
    expect(openQuestions(session).map(({ id }) => id)).toEqual(["q2"])
  })

  it("matches the order the panel shows", () => {
    const session = {
      ...sessionWith([field("a"), field("b")]),
      started: {
        resumeId: PICKED,
        applicationId: OTHER,
        versionId: OTHER,
        fileName: "resume.pdf",
      },
      questions: [question("q1", "a", true), question("q2", "b", false)],
    }
    const view = autofillView(session, null, NOW)
    expect(view.questions.map(({ id }) => id)).toEqual(
      openQuestions(session).map(({ id }) => id)
    )
  })
})

describe("fieldsToFill", () => {
  it("leaves the resume file out, since it is attached", () => {
    const session = sessionWith([field("resume"), field("name")])
    const fills: Fill[] = [
      { fieldId: "resume", source: "rule", kind: "resume-file" },
      { fieldId: "name", source: "rule", kind: "text", value: "Ada" },
    ]
    expect(fieldsToFill(session, fills).map(({ fieldId }) => fieldId)).toEqual([
      "name",
    ])
  })
})

describe("autofillView resume", () => {
  it("keeps the default rule for a kept default the server calls user", () => {
    const session = {
      ...sessionWith([field("a")]),
      defaultResume: { id: PICKED, choice: "company" as const },
      plan: plan({ resumeId: PICKED, resumeChoice: "user" }),
    }
    expect(autofillView(session, null, NOW).resume).toEqual({
      id: PICKED,
      choice: "company",
    })
  })

  it("says user for the user's own pick", () => {
    const session = {
      ...sessionWith([field("a")]),
      resumeId: OTHER,
      defaultResume: { id: PICKED, choice: "company" as const },
      plan: plan({ resumeId: OTHER, resumeChoice: "user" }),
    }
    expect(autofillView(session, null, NOW).resume).toEqual({
      id: OTHER,
      choice: "user",
    })
  })
})

describe("autofillView earlier", () => {
  const earlier = { at: "2026-10-01T00:00:00.000Z", resumeTitle: "Old" }
  const own = { at: "2026-10-21T00:00:00.000Z", resumeTitle: "New" }

  it("shows the plan's earlier fill before the first start", () => {
    const session = {
      ...sessionWith([field("a")]),
      plan: plan({ earlier }),
    }
    expect(autofillView(session, null, NOW).earlier).toEqual(earlier)
  })

  it("keeps the earlier fill the first start found, not the session's own", () => {
    const session = {
      ...sessionWith([field("a")]),
      earlier,
      started: {
        resumeId: PICKED,
        applicationId: OTHER,
        versionId: OTHER,
        fileName: "resume.pdf",
      },
      plan: plan({ earlier: own }),
    }
    expect(autofillView(session, null, NOW).earlier).toEqual(earlier)
  })
})
