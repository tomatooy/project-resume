import { describe, expect, it } from "vitest"
import { newId } from "@workspace/resume-schema"
import { createServices, type Ports } from "../src/services/container"
import { inMemoryPorts } from "../src/testing/ports"
import { emptyProfile } from "../src/autofill-profile/schema"
import type {
  ApplicationAnswer,
  FieldSnapshot,
  PlanInput,
} from "../src/autofill/contract"
import { conditionsForField, meaningForField } from "../src/autofill/answers"
import type { PageView, InterpretedPage } from "../src/autofill/page-contract"
import type { DraftInput } from "../src/autofill/interpreter-port"

function field(over: Partial<FieldSnapshot> = {}): FieldSnapshot {
  return {
    fieldId: "email",
    fieldRevision: 1,
    label: "Email",
    description: "",
    section: "Contact details",
    control: "text",
    attributes: {},
    constraints: { required: true },
    state: {
      visible: true,
      editable: true,
      empty: true,
      hasUserValue: false,
      validationState: "unknown",
      truncated: false,
    },
    userEditEpoch: 0,
    guardRef: "guard",
    capabilities: {
      adapterId: "native-v1",
      read: true,
      write: true,
      discover: false,
      search: false,
      scroll: false,
      verify: true,
    },
    ...over,
  }
}

async function setup(over: Partial<Ports> = {}) {
  const ports = inMemoryPorts()
  const services = createServices({ ...ports, ...over })
  const resume = await services.resumes.create()
  const current = await services.resumes.get(resume.id)
  await services.resumes.update({
    id: resume.id,
    data: {
      ...current.data,
      basics: {
        ...current.data.basics,
        email: "resume@example.test",
        links: [
          {
            id: newId("lnk"),
            label: "LinkedIn",
            url: "https://www.linkedin.com/in/resume",
          },
        ],
      },
    },
  })
  const prepared = await services.autofill.prepare({ resumeId: resume.id })
  const input: PlanInput = {
    automation: "automatic",
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    generation: 1,
    sourceStamp: prepared.sourceStamp,
    sourceSnapshot: prepared.sourceSnapshot,
    applicationContext: {
      applicationId: "application-a",
      employerId: "employer-a",
      jobId: "job-a",
      countryCode: "US",
    },
    target: {
      tabId: 1,
      frameId: 0,
      documentId: "page-one",
      origin: "https://jobs.example.test",
      formId: "application",
    },
    snapshot: {
      schemaVersion: 1,
      snapshotId: "snapshot",
      documentEpoch: 1,
      formRevision: 1,
      formId: "application",
      formLabel: "Apply",
      fields: [field()],
      groups: [],
      coverage: "complete",
      coverageReasons: [],
      observedAt: new Date().toISOString(),
    },
    selections: [],
    overrides: [],
    remainingAttempts: 8,
  }
  return { ports, services, resume, prepared, input }
}

function pageView(): PageView {
  return {
    snapshotId: "snapshot",
    documentEpoch: 1,
    roots: [{ rootId: "root", kind: "document" }],
    nodes: [
      {
        ref: "apply",
        rootId: "root",
        tag: "form",
        text: "Application",
        relations: [],
      },
      {
        ref: "email",
        rootId: "root",
        parentRef: "apply",
        tag: "input",
        text: "Email",
        fieldId: "email",
        relations: [],
      },
      {
        ref: "login",
        rootId: "root",
        tag: "form",
        text: "Sign in",
        relations: [],
      },
      {
        ref: "login-email",
        rootId: "root",
        parentRef: "login",
        tag: "input",
        text: "Email",
        fieldId: "login-email",
        relations: [],
      },
    ],
    coverage: { complete: true, truncated: false, unobservedFrames: 0 },
  }
}

function interpretation(): InterpretedPage {
  return {
    snapshotId: "snapshot",
    regions: [{ regionRef: "apply", evidenceRefs: ["apply"] }],
    fields: [
      {
        fieldId: "email",
        fieldRevision: 1,
        regionRef: "apply",
        concept: "contact_email",
        evidenceRefs: ["email"],
        requiresDraft: false,
      },
    ],
    groups: [],
    excluded: [
      {
        fieldId: "login-email",
        reason: "authentication",
        evidenceRefs: ["login"],
      },
    ],
    needsContext: [],
    unresolvedFieldIds: [],
  }
}

function answer(over: Partial<ApplicationAnswer> = {}): ApplicationAnswer {
  return {
    answerId: crypto.randomUUID(),
    applicationId: "application-a",
    meaning: { concept: "contact_email" },
    conditions: {},
    value: "application@example.test",
    confirmed: true,
    provenance: { kind: "user" },
    ...over,
  }
}

describe("autofill application data", () => {
  it("uses a validated interpretation cache hit after the model budget is exhausted", async () => {
    const { ports, services, input } = await setup({
      autofillInterpreter: { interpret: async () => interpretation() },
    })
    ports.autofillPolicy.value.jevEnabled = true
    input.remainingAttempts = 0
    input.pageView = pageView()
    input.snapshot.fields.push(field({ fieldId: "login-email" }))
    const result = await services.autofill.plan(input)
    expect(result.plan.actions).toMatchObject([
      { fieldId: "email", value: "resume@example.test" },
    ])
    expect(result.attempts).toBe(0)
    expect(
      ports.autofillQuota.attempts.filter((attempt) => attempt.kind === "jev")
    ).toEqual([])
  })

  it("requires validated application regions before using label rules on a broad page view", async () => {
    const { services, input } = await setup()
    input.pageView = pageView()
    input.snapshot.fields.push(field({ fieldId: "login-email" }))
    expect((await services.autofill.plan(input)).plan.actions).toEqual([])
  })

  it("fills only interpreted application fields and accounts for the interpretation attempt", async () => {
    const { ports, services, input } = await setup({
      autofillInterpreter: {
        interpret: async (_input, options) => {
          await options.beforeAttempt()
          return interpretation()
        },
      },
    })
    ports.autofillPolicy.value.jevEnabled = true
    input.pageView = pageView()
    input.snapshot.fields.push(field({ fieldId: "login-email" }))
    const result = await services.autofill.plan(input)
    expect(result.plan.actions).toMatchObject([
      { fieldId: "email", value: "resume@example.test" },
    ])
    expect(result.plan.actions).toHaveLength(1)
    expect(result.decisions[1]?.status).toBe("unsupported")
    expect(result.attempts).toBe(1)
    expect(result.interpretation?.regions).toEqual([
      { regionRef: "apply", evidenceRefs: ["apply"] },
    ])
  })

  it("does not turn fabricated interpretation evidence into application scope", async () => {
    const { ports, services, input } = await setup({
      autofillInterpreter: {
        interpret: async (_input, options) => {
          await options.beforeAttempt()
          const output = interpretation()
          output.regions[0] = { regionRef: "invented", evidenceRefs: ["apply"] }
          return output
        },
      },
    })
    ports.autofillPolicy.value.jevEnabled = true
    input.pageView = pageView()
    input.snapshot.fields.push(field({ fieldId: "login-email" }))
    expect((await services.autofill.plan(input)).plan.actions).toEqual([])
  })

  it("creates reviewable drafts from pinned non-sensitive evidence only", async () => {
    let observed: DraftInput | undefined
    const { ports, services, resume, input } = await setup({
      autofillDrafter: {
        draft: async (question, options) => {
          await options.beforeAttempt()
          observed = question
          const evidence = question.evidence[0]
          if (!evidence) throw new Error("Missing evidence")
          return {
            fieldId: question.fieldId,
            fieldRevision: question.fieldRevision,
            text: "A draft based on the confirmed resume.",
            citations: [
              { evidenceId: evidence.evidenceId, quote: evidence.text },
            ],
            missingInformation: [],
            requiresConfirmation: true,
            grounding: "references_validated",
            model: "test",
          }
        },
      },
    })
    ports.autofillPolicy.value.jevEnabled = true
    await services.autofillProfile.update({
      expectedRevision: 0,
      section: "workAuthorization",
      data: [
        {
          countryCode: "US",
          authorizedToWork: "no",
          requiresSponsorshipNow: "yes",
          requiresSponsorshipFuture: "yes",
        },
      ],
    })
    const prepared = await services.autofill.prepare({ resumeId: resume.id })
    const result = await services.autofill.draft({
      sourceStamp: prepared.sourceStamp,
      sourceSnapshot: prepared.sourceSnapshot,
      target: input.target,
      field: field({
        label: "Why do you want this role?",
        control: "textarea",
      }),
    })
    expect(result.requiresConfirmation).toBe(true)
    expect(
      observed?.evidence.every(
        (item) => !/sponsorship|authorization|email|phone/i.test(item.text)
      )
    ).toBe(true)
    expect(await services.autofillAnswers.list()).toEqual([])
  })

  it("grounds drafts in this application's confirmed corrections without changing the pinned resume", async () => {
    let observed: DraftInput | undefined
    const { ports, services, input } = await setup({
      autofillDrafter: {
        draft: async (question, options) => {
          await options.beforeAttempt()
          observed = question
          const evidence = question.evidence[0]
          if (!evidence) throw new Error("Missing evidence")
          return {
            fieldId: question.fieldId,
            fieldRevision: question.fieldRevision,
            text: "A draft.",
            citations: [
              { evidenceId: evidence.evidenceId, quote: evidence.text },
            ],
            missingInformation: [],
            requiresConfirmation: true,
            grounding: "references_validated",
            model: "test",
          }
        },
      },
    })
    ports.autofillPolicy.value.jevEnabled = true
    const confirmed = answer({
      meaning: { concept: "display_name" },
      value: "Confirmed Name",
    })
    await services.autofill.draft({
      sourceStamp: input.sourceStamp,
      sourceSnapshot: input.sourceSnapshot,
      target: input.target,
      field: field({
        label: "Why do you want this role?",
        control: "textarea",
      }),
      applicationContext: input.applicationContext,
      applicationAnswers: [confirmed],
    })
    expect(
      observed?.evidence.some(
        (item) =>
          item.text.includes("Confirmed Name") &&
          item.sourceRef.kind === "application_answer"
      )
    ).toBe(true)
    expect(
      observed?.evidence.filter((item) => item.sourceRef.key === "basics.name")
    ).toEqual([])
    expect(input.sourceSnapshot?.resume.basics.name).not.toBe("Confirmed Name")
  })

  it("does not treat an answer confirmation as proof of an uncertain field meaning", async () => {
    const { ports, services, input } = await setup()
    ports.autofillPolicy.value.jevEnabled = true
    ports.autofillDecider.answers = [
      {
        id: "email",
        choice: "contact_email",
        probability: 0.6,
        margin: 0.1,
        tied: false,
      },
    ]
    input.snapshot.fields = [field({ label: "Where should we reach out?" })]
    input.applicationAnswers = [answer()]
    expect((await services.autofill.plan(input)).plan.actions).toEqual([])
  })

  it("uses a pinned readable source after the saved resume and profile change", async () => {
    const { services, resume, prepared, input } = await setup()
    expect(prepared.sourceSnapshot.resume.basics.email).toBe(
      "resume@example.test"
    )
    const current = await services.resumes.get(resume.id)
    await services.resumes.update({
      id: resume.id,
      data: {
        ...current.data,
        basics: { ...current.data.basics, email: "new@example.test" },
      },
    })
    await services.autofillProfile.update({
      expectedRevision: 0,
      section: "identity",
      data: { ...emptyProfile().data.identity, email: "profile@example.test" },
    })
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { op: "set_text", value: "resume@example.test" },
    ])
    const document = await services.autofill.document({
      sourceStamp: input.sourceStamp,
      sourceSnapshot: prepared.sourceSnapshot,
    })
    expect(document.resume.basics.email).toBe("resume@example.test")
  })

  it("rejects an inconsistent source hash and a source no longer owned", async () => {
    const { services, resume, prepared, input } = await setup()
    prepared.sourceSnapshot.resume.basics.email = "tampered@example.test"
    await expect(services.autofill.plan(input)).rejects.toMatchObject({
      code: "VALIDATION",
    })
    const fresh = await services.autofill.prepare({ resumeId: resume.id })
    input.sourceSnapshot = fresh.sourceSnapshot
    await services.resumes.remove(resume.id)
    await expect(services.autofill.plan(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })

  it("uses saved Profile values first and safely falls back to resume links", async () => {
    const { services, resume, input } = await setup()
    await services.autofillProfile.update({
      expectedRevision: 0,
      section: "identity",
      data: { ...emptyProfile().data.identity, email: "profile@example.test" },
    })
    const prepared = await services.autofill.prepare({ resumeId: resume.id })
    input.sourceStamp = prepared.sourceStamp
    input.sourceSnapshot = prepared.sourceSnapshot
    input.snapshot.fields.push(
      field({ fieldId: "linkedin", label: "LinkedIn" })
    )
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { value: "profile@example.test" },
      { value: "https://www.linkedin.com/in/resume" },
    ])
    expect((await services.resumes.get(resume.id)).data.basics.email).toBe(
      "resume@example.test"
    )
  })

  it("reuses an application answer across documents without reusing a DOM id", async () => {
    const { services, input } = await setup()
    input.applicationAnswers = [answer()]
    input.target.documentId = "page-two"
    input.snapshot.fields = [field({ fieldId: "new-email" })]
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { fieldId: "new-email", value: "application@example.test" },
    ])
    input.applicationContext = { applicationId: "application-b" }
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { value: "resume@example.test" },
    ])
  })

  it("does not reuse a scoped answer when a required condition is absent or different", async () => {
    const { services, input } = await setup()
    input.applicationAnswers = [
      answer({ conditions: { countryCode: "CA", currency: "CAD" } }),
    ]
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { value: "resume@example.test" },
    ])
    input.applicationContext = {
      applicationId: "application-a",
      countryCode: "CA",
    }
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { value: "resume@example.test" },
    ])
    input.applicationContext.currency = "CAD"
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { value: "application@example.test" },
    ])
  })

  it("does not let unknown answers or old field ids replace known facts", async () => {
    const { services, input } = await setup()
    input.applicationAnswers = [answer({ value: "unknown" })]
    input.overrides = [
      {
        overrideId: crypto.randomUUID(),
        concept: "contact_email",
        fieldId: "email",
        documentId: "old-document",
        value: "old@example.test",
      },
    ]
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { value: "resume@example.test" },
    ])
  })

  it("fills an open question only after confirming its exact answer", async () => {
    const { services, input } = await setup()
    input.snapshot.fields = [
      field({ label: "Why do you want this role?", control: "textarea" }),
    ]
    const first = await services.autofill.plan(input)
    expect(first.plan.actions).toEqual([])
    const meaning = first.decisions[0]?.meaning
    expect(meaning?.concept).toBe("open_answer")
    if (!meaning) throw new Error("Missing answer meaning")
    input.applicationAnswers = [
      answer({
        meaning,
        value: "I want to apply my confirmed experience to this role.",
        provenance: { kind: "confirmed_draft" },
      }),
    ]
    const filled = await services.autofill.plan(input)
    expect(filled.plan.actions).toMatchObject([
      {
        op: "set_text",
        value: "I want to apply my confirmed experience to this role.",
      },
    ])
    expect(await services.autofillAnswers.list()).toEqual([])
  })

  it("keeps record answers bound to their own record", async () => {
    const { services, resume, input } = await setup()
    const current = await services.resumes.get(resume.id)
    const recordId = newId("edu")
    await services.resumes.update({
      id: resume.id,
      data: {
        ...current.data,
        sections: [
          {
            id: newId("sec"),
            type: "education",
            title: "Education",
            items: [
              {
                id: recordId,
                kind: "education",
                school: "Saved School",
                bullets: [],
              },
            ],
          },
        ],
      },
    })
    const prepared = await services.autofill.prepare({ resumeId: resume.id })
    input.sourceStamp = prepared.sourceStamp
    input.sourceSnapshot = prepared.sourceSnapshot
    input.snapshot.fields = [field({ label: "School", section: "Education" })]
    input.applicationAnswers = [
      answer({
        meaning: { concept: "education_school" },
        recordId: newId("edu"),
        value: "Other School",
      }),
    ]
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { value: "Saved School" },
    ])
  })

  it("rejects duplicate supplemental record identities", async () => {
    const { services, input } = await setup()
    const record = {
      id: newId("edu"),
      kind: "education",
      school: "This application only",
      bullets: [],
    } satisfies NonNullable<PlanInput["supplementalRecords"]>[number]["record"]
    input.supplementalRecords = [
      { applicationId: "application-a", confirmed: true, record },
      { applicationId: "application-a", confirmed: true, record },
    ]
    await expect(services.autofill.plan(input)).rejects.toMatchObject({
      code: "VALIDATION",
    })
  })
})

it("assigns a fully empty record group in selected resume order and reserves populated bindings", async () => {
  const { services, resume, input } = await setup()
  const current = await services.resumes.get(resume.id)
  const records = ["First School", "Second School", "Third School"].map(
    (school) =>
      ({
        id: newId("edu"),
        kind: "education",
        school,
        degree: "Degree",
        bullets: [],
      }) satisfies NonNullable<
        PlanInput["supplementalRecords"]
      >[number]["record"]
  )
  await services.resumes.update({
    id: resume.id,
    data: {
      ...current.data,
      sections: [
        {
          id: newId("sec"),
          type: "education",
          title: "Education",
          items: records,
        },
      ],
    },
  })
  const prepared = await services.autofill.prepare({ resumeId: resume.id })
  input.sourceSnapshot = prepared.sourceSnapshot
  input.sourceStamp = prepared.sourceStamp
  input.snapshot.fields = [
    field({
      fieldId: "school-one",
      label: "School",
      section: "Education",
      groupId: "group-one",
    }),
  ]
  input.snapshot.groups = [
    { groupId: "group-one", kind: "education", label: "Education" },
  ]
  const first = await services.autofill.plan(input)
  expect(first.plan.actions).toMatchObject([
    { fieldId: "school-one", value: "First School" },
  ])
  const recordId = first.decisions[0]?.recordId
  expect(recordId).toBe(records[0]?.id)
  input.snapshot.coverage = "partial"
  expect((await services.autofill.plan(input)).plan.actions).toEqual([])
  input.snapshot.coverage = "complete"
  if (!recordId) throw new Error("Missing record binding")
  input.recordBindings = [{ groupId: "previous-batch-group", recordId }]
  expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
    { value: "Second School" },
  ])
  input.recordBindings = [{ groupId: "group-one", recordId }]
  expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
    { value: "First School" },
  ])
  input.recordBindings = []
  input.snapshot.fields = [
    field({
      fieldId: "school-one",
      label: "School",
      section: "Education",
      groupId: "group-one",
      state: { ...field().state, empty: false },
    }),
    field({
      fieldId: "school-two",
      label: "School",
      section: "Education",
      groupId: "group-two",
    }),
    field({
      fieldId: "degree-two",
      label: "Degree",
      section: "Education",
      groupId: "group-two",
    }),
  ]
  input.snapshot.groups.push({
    groupId: "group-two",
    kind: "education",
    label: "Education",
  })
  input.selections = [
    {
      fieldId: "school-one",
      concept: "education_school",
      fieldRevision: 1,
      guardRef: "guard",
      profileRevision: input.sourceStamp.profileRevision,
      confirmed: true,
      replace: false,
      recordId,
    },
  ]
  const second = await services.autofill.plan(input)
  expect(second.plan.actions).toMatchObject([
    { fieldId: "school-two", value: "Second School" },
    { fieldId: "degree-two", value: "Degree" },
  ])
  expect(
    second.decisions
      .filter((decision) => decision.fieldId.endsWith("two"))
      .every((decision) => decision.recordId === records[1]?.id)
  ).toBe(true)
  input.selections = []
  expect((await services.autofill.plan(input)).plan.actions).toEqual([])
  input.snapshot.fields[0] = field({
    fieldId: "school-one",
    label: "School",
    section: "Education",
    groupId: "group-one",
    state: { ...field().state, empty: true, commitState: "unknown" },
  })
  expect((await services.autofill.plan(input)).plan.actions).toEqual([])
})

describe("confirmed scoped answers", () => {
  it("requires country and complete salary conditions when saving scoped facts", async () => {
    const { services } = await setup()
    await expect(
      services.autofillAnswers.save({
        expectedRevision: 0,
        confirmed: true,
        meaning: { concept: "work_authorized" },
        conditions: { employerId: "employer-a" },
        value: "no",
        provenance: { kind: "user" },
      })
    ).rejects.toMatchObject({ code: "VALIDATION" })
    await expect(
      services.autofillAnswers.save({
        expectedRevision: 0,
        confirmed: true,
        meaning: { concept: "salary" },
        conditions: { countryCode: "US" },
        value: "120000",
        provenance: { kind: "user" },
      })
    ).rejects.toMatchObject({ code: "VALIDATION" })
    await expect(
      services.autofillAnswers.save({
        expectedRevision: 0,
        confirmed: true,
        meaning: {
          concept: "eeo_gender",
          questionKey: "gender identity",
          definitionVersion: "vs-us-1",
        },
        conditions: { employerId: "employer-a" },
        value: "Prefer not to say",
        provenance: { kind: "user" },
      })
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("does not borrow a fallback country when the question has multiple countries", () => {
    expect(
      conditionsForField(
        field({
          label:
            "Are you authorized to work in Canada or in the United States?",
        }),
        "US"
      ).countryCode
    ).toBeUndefined()
  })

  it("does not reuse incomplete application scopes for sensitive questions", async () => {
    const { services, input } = await setup()
    input.snapshot.fields = [
      field({ label: "Are you authorized to work in the United States?" }),
    ]
    input.applicationAnswers = [
      answer({ meaning: { concept: "work_authorized" }, value: "no" }),
    ]
    expect((await services.autofill.plan(input)).plan.actions).toEqual([])
    input.applicationAnswers = [
      answer({
        meaning: { concept: "work_authorized" },
        value: "no",
        conditions: { countryCode: "US" },
      }),
    ]
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { value: "no" },
    ])
  })

  it("does not obtain missing salary units from a saved answer", async () => {
    const { services, resume, input } = await setup()
    await services.autofillAnswers.save({
      expectedRevision: 0,
      confirmed: true,
      meaning: { concept: "salary" },
      conditions: { currency: "USD", salaryPeriod: "year" },
      value: "120000",
      provenance: { kind: "user" },
    })
    const prepared = await services.autofill.prepare({ resumeId: resume.id })
    input.sourceSnapshot = prepared.sourceSnapshot
    input.sourceStamp = prepared.sourceStamp
    input.snapshot.fields = [field({ label: "Desired salary" })]
    expect((await services.autofill.plan(input)).plan.actions).toEqual([])
    input.snapshot.fields = [field({ label: "Desired annual salary in USD" })]
    input.selections = [
      {
        fieldId: "email",
        fieldRevision: 1,
        guardRef: "guard",
        profileRevision: input.sourceStamp.profileRevision,
        concept: "salary",
        confirmed: true,
        replace: false,
      },
    ]
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { value: "120000" },
    ])
  })

  it("requires the exact EEO question and definition as well as the country", async () => {
    const { services, input } = await setup()
    const question = field({ label: "Gender identity" })
    input.snapshot.fields = [question]
    const meaning = meaningForField(question, "eeo_gender")
    input.applicationAnswers = [
      answer({
        meaning: { ...meaning, definitionVersion: "question-v1" },
        conditions: { countryCode: "US" },
        value: "Prefer not to say",
      }),
    ]
    expect((await services.autofill.plan(input)).plan.actions).toEqual([])
    input.applicationAnswers = [
      answer({
        meaning,
        conditions: { countryCode: "US" },
        value: "Prefer not to say",
      }),
    ]
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { value: "Prefer not to say" },
    ])
    input.snapshot.fields = [
      field({
        label: "Gender identity",
        description: "Use the categories defined for this application.",
      }),
    ]
    expect((await services.autofill.plan(input)).plan.actions).toEqual([])
  })

  it("requires explicit save, retains provenance, and uses compare-and-swap", async () => {
    const { services } = await setup()
    const saved = await services.autofillAnswers.save({
      expectedRevision: 0,
      confirmed: true,
      meaning: { concept: "salary" },
      conditions: {
        employerId: "employer-a",
        countryCode: "US",
        currency: "USD",
        salaryPeriod: "year",
      },
      value: "120000 USD / year",
      provenance: { kind: "user" },
    })
    expect(saved.revision).toBe(1)
    expect(saved.confirmedAt).toBeTruthy()
    await expect(
      services.autofillAnswers.save({
        id: saved.id,
        meaning: saved.meaning,
        conditions: saved.conditions,
        value: saved.value,
        provenance: saved.provenance,
        expectedRevision: 0,
        confirmed: true,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(
      services.autofillAnswers.remove({ id: saved.id, expectedRevision: 0 })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await services.autofillAnswers.remove({ id: saved.id, expectedRevision: 1 })
    expect(await services.autofillAnswers.list()).toEqual([])
  })

  it("does not store resume history in the reusable answer library", async () => {
    const { services } = await setup()
    await expect(
      services.autofillAnswers.save({
        expectedRevision: 0,
        confirmed: true,
        meaning: { concept: "experience_company" },
        conditions: { employerId: "employer-a" },
        value: "New employer",
        provenance: { kind: "user" },
      })
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("reuses only saved answers with matching conditions and keeps them pinned", async () => {
    const { services, resume, input } = await setup()
    const saved = await services.autofillAnswers.save({
      expectedRevision: 0,
      confirmed: true,
      meaning: { concept: "contact_email" },
      conditions: { employerId: "employer-a" },
      value: "scoped@example.test",
      provenance: { kind: "user" },
    })
    const prepared = await services.autofill.prepare({ resumeId: resume.id })
    input.sourceSnapshot = prepared.sourceSnapshot
    input.sourceStamp = prepared.sourceStamp
    await services.autofillAnswers.save({
      id: saved.id,
      expectedRevision: 1,
      confirmed: true,
      meaning: saved.meaning,
      conditions: saved.conditions,
      value: "changed@example.test",
      provenance: saved.provenance,
    })
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { value: "scoped@example.test" },
    ])
    input.applicationContext = { applicationId: "application-a" }
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { value: "resume@example.test" },
    ])
  })
})
