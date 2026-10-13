import { describe, expect, it } from "vitest"
import { newId } from "@workspace/resume-schema"
import { createServices } from "../src/services/container"
import { inMemoryPorts } from "../src/testing/ports"
import { AutofillProfileService } from "../src/autofill-profile/service"
import {
  emptyProfile,
  ProfileUpdateSchema,
} from "../src/autofill-profile/schema"
import {
  InMemoryAutofillProfileRepository,
  InMemoryAutofillQuota,
} from "../src/testing/autofill"
import {
  ActionSchema,
  type FieldSnapshot,
  type PlanInput,
} from "../src/autofill/contract"

function field(over: Partial<FieldSnapshot> = {}): FieldSnapshot {
  return {
    fieldId: "email",
    fieldRevision: 1,
    label: "Email",
    description: "",
    section: "Contact details",
    control: "text",
    attributes: { autocomplete: "email" },
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
    capabilities: {
      adapterId: "native-v1",
      read: true,
      write: true,
      discover: false,
      search: false,
      scroll: false,
      verify: true,
    },
    guardRef: "guard",
    ...over,
  }
}
async function setup() {
  const ports = inMemoryPorts()
  const services = createServices(ports)
  const resume = await services.resumes.create()
  const current = await services.resumes.get(resume.id)
  await services.resumes.update({
    id: resume.id,
    data: {
      ...current.data,
      basics: { ...current.data.basics, email: "applicant@example.test" },
    },
  })
  const prepared = await services.autofill.prepare({ resumeId: resume.id })
  const input: PlanInput = {
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    generation: 1,
    sourceStamp: prepared.sourceStamp,
    target: {
      tabId: 1,
      frameId: 0,
      documentId: "document",
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
  return { ports, services, input, resume }
}
describe("account profile", () => {
  it("exists without a resume and uses compare-and-swap without losing other sections", async () => {
    const repository = new InMemoryAutofillProfileRepository()
    const service = new AutofillProfileService(repository)
    expect((await service.get()).revision).toBe(0)
    const first = await service.update({
      expectedRevision: 0,
      section: "identity",
      data: { ...emptyProfile().data.identity, legalGivenName: "Ada" },
    })
    expect(first.revision).toBe(1)
    await expect(
      service.update({
        expectedRevision: 0,
        section: "links",
        data: emptyProfile().data.links,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    const next = await service.update({
      expectedRevision: 1,
      section: "links",
      data: {
        ...first.data.links,
        linkedinUrl: "https://linkedin.com/in/ada/",
      },
    })
    expect(next.data.identity.legalGivenName).toBe("Ada")
    expect(next.data.links.linkedinUrl).toBe("https://www.linkedin.com/in/ada")
  })
  it("distinguishes unknown sponsorship from no and clearing EEO from declining", async () => {
    const service = new AutofillProfileService(
      new InMemoryAutofillProfileRepository()
    )
    const one = await service.update({
      expectedRevision: 0,
      section: "workAuthorization",
      data: [
        {
          countryCode: "US",
          authorizedToWork: "yes",
          requiresSponsorshipNow: "no",
          requiresSponsorshipFuture: "unknown",
        },
      ],
    })
    expect(one.data.workAuthorization[0]?.requiresSponsorshipFuture).toBe(
      "unknown"
    )
    const two = await service.update({
      expectedRevision: 1,
      section: "eeo",
      data: {
        responses: [
          {
            countryCode: "US",
            questionKey: "gender",
            definitionVersion: "vs-us-1",
            answer: { state: "decline_to_answer" },
          },
        ],
      },
    })
    expect(two.data.eeo.responses[0]?.confirmedAt).toBeTruthy()
    const three = await service.update({
      expectedRevision: 2,
      section: "eeo",
      data: { responses: [] },
    })
    expect(three.data.eeo.responses).toEqual([])
    expect(three.data.workAuthorization).toEqual(one.data.workAuthorization)
  })
  it("rejects unknown answer codes, duplicate definitions, and non-profile LinkedIn URLs", () => {
    expect(
      ProfileUpdateSchema.safeParse({
        expectedRevision: 0,
        section: "links",
        data: {
          ...emptyProfile().data.links,
          linkedinUrl: "https://linkedin.com/jobs/view/123",
        },
      }).success
    ).toBe(false)
    expect(
      ProfileUpdateSchema.safeParse({
        expectedRevision: 0,
        section: "eeo",
        data: {
          responses: [
            {
              countryCode: "US",
              questionKey: "disability",
              definitionVersion: "vs-us-1",
              answer: { state: "answered", code: "probably" },
            },
          ],
        },
      }).success
    ).toBe(false)
  })
})
describe("autofill planner", () => {
  it.each([
    ["yes", "yes", "yes"],
    ["yes", "no", "yes"],
    ["yes", "unknown", "yes"],
    ["no", "yes", "yes"],
    ["no", "no", "no"],
    ["no", "unknown", null],
    ["unknown", "yes", "yes"],
    ["unknown", "no", null],
    ["unknown", "unknown", null],
  ] as const)(
    "combines sponsorship now=%s future=%s without inventing missing facts",
    async (now, future, expected) => {
      const { services, ports, input, resume } = await setup()
      await services.autofillProfile.update({
        expectedRevision: 0,
        section: "workAuthorization",
        data: [
          {
            countryCode: "US",
            authorizedToWork: "yes",
            requiresSponsorshipNow: now,
            requiresSponsorshipFuture: future,
          },
        ],
      })
      input.automation = "automatic"
      input.sourceStamp = (
        await services.autofill.prepare({ resumeId: resume.id })
      ).sourceStamp
      input.snapshot.fields = [
        field({
          label:
            "Will you now or in the future require visa sponsorship to work in the United States?",
        }),
      ]
      const result = await services.autofill.plan(input)
      expect(result.decisions[0]?.semanticKey).toBe("sponsorship_now_or_future")
      if (expected)
        expect(result.plan.actions).toMatchObject([
          { op: "set_text", value: expected },
        ])
      else {
        expect(result.plan.actions).toEqual([])
        expect(result.decisions[0]?.status).toBe("missing_data")
      }
      expect(ports.autofillDecider.calls).toEqual([])
    }
  )
  it("fills saved exact answers in automatic mode without individual confirmations", async () => {
    const { services, input } = await setup()
    input.automation = "automatic"
    const result = await services.autofill.plan(input)
    expect(result.plan.actions).toMatchObject([
      { op: "set_text", value: "applicant@example.test" },
    ])
    expect(input.selections).toEqual([])
  })
  it("keeps compound sponsorship scoped to the country and the exact question", async () => {
    const { services, ports, input, resume } = await setup()
    await services.autofillProfile.update({
      expectedRevision: 0,
      section: "workAuthorization",
      data: [
        {
          countryCode: "CA",
          authorizedToWork: "yes",
          requiresSponsorshipNow: "yes",
          requiresSponsorshipFuture: "yes",
        },
      ],
    })
    input.automation = "automatic"
    input.sourceStamp = (
      await services.autofill.prepare({ resumeId: resume.id })
    ).sourceStamp
    input.snapshot.fields = [
      field({
        label:
          "Will you now or in the future require visa sponsorship to work in the United States?",
      }),
    ]
    const missing = await services.autofill.plan(input)
    expect(missing.plan.actions).toEqual([])
    expect(missing.decisions[0]?.reasonCode).toBe("missing_scoped_fact")
    input.countryCode = "CA"
    expect((await services.autofill.plan(input)).decisions[0]?.reasonCode).toBe(
      "country_scope_conflict"
    )
    input.countryCode = undefined
    input.snapshot.fields = [
      field({ label: "Do you need sponsorship both now and in the future?" }),
    ]
    ports.autofillPolicy.value.jevEnabled = true
    ports.autofillDecider.answers = [
      {
        id: "email",
        choice: "sponsorship_now_or_future",
        probability: 0.99,
        margin: 0.98,
        tied: false,
      },
    ]
    const different = await services.autofill.plan(input)
    expect(different.plan.actions).toEqual([])
    expect(different.decisions[0]?.reasonCode).toBe("compound_scope")
  })
  it.each([0.99, 0.7])(
    "only automatically uses confident model semantics (%s)",
    async (probability) => {
      const { ports, services, input } = await setup()
      input.automation = "automatic"
      ports.autofillPolicy.value.jevEnabled = true
      input.snapshot.fields[0] = field({
        label: "Where can our team email you?",
      })
      ports.autofillDecider.answers = [
        {
          id: "email",
          choice: "contact_email",
          probability,
          margin: 0.3,
          tied: false,
        },
      ]
      expect((await services.autofill.plan(input)).plan.actions).toHaveLength(
        probability > 0.95 ? 1 : 0
      )
    }
  )
  it("automatically matches an observed option without a confirmation round", async () => {
    const { ports, services, input } = await setup()
    input.automation = "automatic"
    ports.autofillPolicy.value.jevEnabled = true
    ports.autofillDecider.answers = [
      {
        id: "email",
        choice: "observed",
        probability: 0.99,
        margin: 0.95,
        tied: false,
      },
    ]
    input.snapshot.fields = [
      field({
        control: "single_select",
        options: {
          fieldId: "email",
          fieldRevision: 1,
          optionsRevision: 1,
          queryRevision: 0,
          query: "",
          loadState: "ready",
          coverage: "complete",
          hasMore: false,
          canSearch: false,
          canScroll: false,
          options: [
            {
              optionId: "observed",
              label: "applicant (at) example.test",
              description: "",
              disabled: false,
              placeholder: false,
              selected: false,
            },
          ],
        },
      }),
    ]
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { op: "set_single", optionId: "observed" },
    ])
  })
  it("keeps a confident record choice across fields and subsequent plans", async () => {
    const { ports, services, input, resume } = await setup()
    const current = await services.resumes.get(resume.id)
    const section = current.data.sections.find((s) => s.type === "experience")
    const first = section?.items.find((item) => item.kind === "experience")
    if (!section || !first) throw new Error("Missing experience fixture")
    const selected = {
      ...first,
      id: newId("exp"),
      company: "Second company",
      role: "Second role",
      bullets: [],
    }
    section.items.push(selected)
    await services.resumes.update({ id: resume.id, data: current.data })
    input.sourceStamp = (
      await services.autofill.prepare({ resumeId: resume.id })
    ).sourceStamp
    input.automation = "automatic"
    input.snapshot.groups = [
      { groupId: "work", label: "Second company", kind: "experience" },
    ]
    input.snapshot.fields = [
      field({
        fieldId: "company",
        label: "Company",
        groupId: "work",
        section: "Experience",
      }),
      field({
        fieldId: "role",
        label: "Job title",
        groupId: "work",
        section: "Experience",
      }),
    ]
    ports.autofillPolicy.value.jevEnabled = true
    ports.autofillDecider.answers = [
      {
        id: "company",
        choice: selected.id,
        probability: 0.99,
        margin: 0.98,
        tied: false,
      },
    ]
    const result = await services.autofill.plan(input)
    expect(result.plan.actions).toMatchObject([
      { fieldId: "company", value: "Second company" },
      { fieldId: "role", value: "Second role" },
    ])
    expect(
      ports.autofillDecider.calls.flat().map((question) => question.kind)
    ).toEqual(["record"])
    input.selections = [
      {
        fieldId: "company",
        fieldRevision: 1,
        concept: "experience_company",
        recordId: selected.id,
        confirmed: false,
        replace: false,
        guardRef: "guard",
        profileRevision: 0,
      },
    ]
    input.snapshot.fields[0] = field({
      fieldId: "company",
      label: "Company",
      groupId: "work",
      section: "Experience",
      state: { ...field().state, empty: false, hasUserValue: true },
    })
    expect((await services.autofill.plan(input)).plan.actions).toMatchObject([
      { fieldId: "role", value: "Second role" },
    ])
    expect(ports.autofillDecider.calls).toHaveLength(1)
  })
  it("uploads only a PDF-compatible resume control and preserves existing attachments", async () => {
    const { services, input, ports } = await setup()
    input.automation = "automatic"
    input.snapshot.fields = [
      field({
        fieldId: "resume",
        label: "Resume / CV",
        control: "file",
        attributes: { accept: ".pdf,.docx" },
      }),
      field(),
    ]
    const result = await services.autofill.plan(input)
    expect(result.plan.actions.map((a) => a.op)).toEqual([
      "upload_resume",
      "set_text",
    ])
    expect(ports.autofillDecider.calls).toEqual([])
    for (const over of [
      { label: "Cover letter" },
      { label: "Other attachment" },
      { attributes: { accept: ".docx" } },
      { state: { ...field().state, empty: false, hasUserValue: true } },
    ]) {
      input.snapshot.fields = [
        field({ fieldId: "resume", label: "Resume", control: "file", ...over }),
      ]
      expect((await services.autofill.plan(input)).plan.actions).toEqual([])
    }
  })
  it("exports only the stamped resume for PDF rendering and rejects changed sources", async () => {
    const { services, input, resume } = await setup()
    const document = await services.autofill.document({
      sourceStamp: input.sourceStamp,
    })
    expect(document.resume.basics.email).toBe("applicant@example.test")
    expect(document).not.toHaveProperty("profile")
    expect(document.sourceStamp).toEqual(input.sourceStamp)
    await services.resumes.update({
      id: resume.id,
      data: {
        ...document.resume,
        basics: { ...document.resume.basics, email: "changed@example.test" },
      },
    })
    await expect(
      services.autofill.document({ sourceStamp: input.sourceStamp })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(
      services.autofill.document({
        sourceStamp: { ...input.sourceStamp, resumeId: crypto.randomUUID() },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
  it("uses fixed resume facts and compiles only evaluated rule actions", async () => {
    const { ports, services, input } = await setup()
    expect((await services.autofill.plan(input)).plan.actions).toEqual([])
    ports.autofillPolicy.value.autoRules = ["label:contact_email"]
    const result = await services.autofill.plan(input)
    expect(result.plan.actions[0]).toMatchObject({
      op: "set_text",
      value: "applicant@example.test",
      guardRef: "guard",
      userEditEpoch: 0,
    })
    expect(ports.autofillDecider.calls).toEqual([])
    expect(ports.db.versions).toHaveLength(0)
  })
  it("does not call Jev or compile actions while the global policy is disabled", async () => {
    const { ports, services, input } = await setup()
    ports.autofillPolicy.value.enabled = false
    ports.autofillPolicy.value.jevEnabled = true
    input.snapshot.fields.push(
      field({ fieldId: "unknown", label: "How can our team reach you?" })
    )
    const result = await services.autofill.plan(input)
    expect(
      result.decisions.every((d) => d.reasonCode === "policy_disabled")
    ).toBe(true)
    expect(result.plan.actions).toEqual([])
    expect(ports.autofillDecider.calls).toEqual([])
  })
  it("never issues a plan that outlives its execution policy", async () => {
    const { ports, services, input } = await setup()
    ports.autofillPolicy.value.expiresAt = new Date(
      ports.clock().getTime() + 10000
    ).toISOString()
    const result = await services.autofill.plan(input)
    expect(result.plan.expiresAt).toBe(ports.autofillPolicy.value.expiresAt)
  })
  it("keeps immutable version sources stable when the head changes and rejects foreign versions", async () => {
    const { ports, services, input, resume } = await setup()
    const version = await services.versions.snapshot(resume.id, {
      createdBy: "user",
    })
    input.sourceStamp = (
      await services.autofill.prepare({
        resumeId: resume.id,
        versionId: version.id,
      })
    ).sourceStamp
    const current = await services.resumes.get(resume.id)
    await services.resumes.update({
      id: resume.id,
      data: {
        ...current.data,
        basics: { ...current.data.basics, email: "updated@example.test" },
      },
    })
    ports.autofillPolicy.value.autoRules = ["label:contact_email"]
    expect((await services.autofill.plan(input)).plan.actions[0]).toMatchObject(
      { value: "applicant@example.test" }
    )
    const other = await services.resumes.create()
    await expect(
      services.autofill.prepare({ resumeId: other.id, versionId: version.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
  it("keeps declarations manual even when hidden among grouped options", async () => {
    const { services, input } = await setup()
    input.snapshot.fields = [
      field({
        control: "checkbox_group",
        label: "Preferences",
        options: {
          fieldId: "email",
          fieldRevision: 1,
          optionsRevision: 1,
          queryRevision: 0,
          query: "",
          loadState: "ready",
          coverage: "complete",
          hasMore: false,
          canSearch: false,
          canScroll: false,
          options: [
            {
              optionId: "agree",
              label: "I agree to the privacy policy",
              description: "",
              disabled: false,
              placeholder: false,
              selected: false,
            },
          ],
        },
      }),
    ]
    const result = await services.autofill.plan(input)
    expect(result.decisions[0]?.reasonCode).toBe("manual_only")
    expect(result.plan.actions).toEqual([])
  })
  it.each([
    "Reference email",
    "I certify these answers",
    "Password",
    "Agree to privacy policy",
    "Cover letter",
  ])("never executes manual question %s", async (label) => {
    const { ports, services, input } = await setup()
    ports.autofillPolicy.value.autoRules = ["label:contact_email"]
    input.snapshot.fields = [field({ label })]
    const result = await services.autofill.plan(input)
    expect(result.plan.actions).toEqual([])
    expect(["blocked", "needs_draft"]).toContain(result.decisions[0]?.status)
  })
  it("preserves human input and does not infer legal names or missing addresses", async () => {
    const { services, input } = await setup()
    input.snapshot.fields = [
      field({ state: { ...field().state, empty: false, hasUserValue: true } }),
      field({ fieldId: "first", label: "First name" }),
      field({ fieldId: "zip", label: "Postal code" }),
    ]
    const result = await services.autofill.plan(input)
    expect(result.decisions.map((d) => d.status)).toEqual([
      "preserved",
      "missing_data",
      "missing_data",
    ])
  })
  it("does not restore a missing Profile link from a resume", async () => {
    const { services, input } = await setup()
    input.snapshot.fields = [field({ label: "LinkedIn" })]
    expect((await services.autofill.plan(input)).decisions[0]?.status).toBe(
      "missing_data"
    )
  })
  it("rejects changed Profile and resume stamps", async () => {
    const { services, input } = await setup()
    await services.autofillProfile.update({
      expectedRevision: 0,
      section: "links",
      data: emptyProfile().data.links,
    })
    await expect(services.autofill.plan(input)).rejects.toMatchObject({
      code: "CONFLICT",
    })
  })
  it("rechecks the source after model work", async () => {
    const { ports, services, input, resume } = await setup()
    ports.autofillPolicy.value.jevEnabled = true
    ports.autofillDecider.decide = async () => {
      const current = await services.resumes.get(resume.id)
      await services.resumes.update({
        id: resume.id,
        data: {
          ...current.data,
          basics: { ...current.data.basics, name: "Changed" },
        },
      })
      return []
    }
    input.snapshot.fields = [
      field({ label: "Where can recruitment reach you?" }),
    ]
    await expect(services.autofill.plan(input)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "source_changed",
    })
  })
  it("requires a saved, matching, confirmed EEO answer and never sends it to Jev", async () => {
    const { ports, services, input } = await setup()
    await services.autofillProfile.update({
      expectedRevision: 0,
      section: "eeo",
      data: {
        responses: [
          {
            countryCode: "US",
            questionKey: "gender",
            definitionVersion: "vs-us-1",
            answer: { state: "decline_to_answer" },
          },
        ],
      },
    })
    input.sourceStamp = (
      await services.autofill.prepare({ resumeId: input.sourceStamp.resumeId })
    ).sourceStamp
    input.countryCode = "US"
    input.snapshot.fields = [field({ label: "Gender identity" })]
    ports.autofillPolicy.value.jevEnabled = true
    expect((await services.autofill.plan(input)).plan.actions).toEqual([])
    input.selections = [
      {
        fieldId: "email",
        fieldRevision: 1,
        concept: "eeo_gender",
        confirmed: true,
        replace: false,
        guardRef: "guard",
        profileRevision: 1,
      },
    ]
    expect((await services.autofill.plan(input)).plan.actions[0]).toMatchObject(
      { value: "Prefer not to say" }
    )
    input.automation = "automatic"
    input.selections = []
    expect((await services.autofill.plan(input)).plan.actions[0]).toMatchObject(
      { value: "Prefer not to say" }
    )
    input.snapshot.fields = [
      field({
        label: "Gender identity",
        description: "A different classification",
      }),
    ]
    expect((await services.autofill.plan(input)).plan.actions).toEqual([])
    expect(JSON.stringify(ports.autofillDecider.calls)).not.toContain(
      "Prefer not to say"
    )
  })
  it("requires actual options, preserving label/value separation", async () => {
    const { ports, services, input } = await setup()
    ports.autofillPolicy.value.autoRules = ["label:contact_email"]
    input.snapshot.fields = [
      field({
        control: "single_select",
        options: {
          fieldId: "email",
          fieldRevision: 1,
          optionsRevision: 4,
          queryRevision: 2,
          query: "",
          loadState: "ready",
          coverage: "complete",
          hasMore: false,
          canSearch: false,
          canScroll: false,
          options: [
            {
              optionId: "observed",
              label: "applicant@example.test",
              description: "",
              disabled: false,
              placeholder: false,
              selected: false,
            },
          ],
        },
      }),
    ]
    expect((await services.autofill.plan(input)).plan.actions[0]).toMatchObject(
      {
        op: "set_single",
        optionId: "observed",
        optionsRevision: 4,
        queryRevision: 2,
      }
    )
  })
  it("does not accept executable model actions or forged snapshot identities", async () => {
    expect(
      ActionSchema.safeParse({ op: "execute_script", value: "alert(1)" })
        .success
    ).toBe(false)
    const { services, input } = await setup()
    input.target.formId = "different"
    await expect(services.autofill.plan(input)).rejects.toMatchObject({
      code: "VALIDATION",
    })
  })
  it("bounds account quota attempts", async () => {
    const quota = new InMemoryAutofillQuota(() => 1000)
    for (let i = 0; i < 20; i++) await quota.reserve("plan")
    await expect(quota.reserve("plan")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    })
  })
})

it("keeps Profile data out of resume copies and versions", async () => {
  const { services, resume } = await setup()
  await services.autofillProfile.update({
    expectedRevision: 0,
    section: "address",
    data: {
      ...emptyProfile().data.address,
      addressLine1: "Synthetic private street",
    },
  })
  const current = await services.resumes.get(resume.id)
  expect(JSON.stringify(current)).not.toContain("Synthetic private street")
  const copy = await services.resumes.duplicate(resume.id)
  expect(JSON.stringify(await services.resumes.get(copy.id))).not.toContain(
    "Synthetic private street"
  )
  await services.resumes.remove(resume.id)
  expect((await services.autofillProfile.get()).data.address.addressLine1).toBe(
    "Synthetic private street"
  )
})
it("does not equate a general veteran answer with protected-veteran status", async () => {
  const { services, input } = await setup()
  await services.autofillProfile.update({
    expectedRevision: 0,
    section: "eeo",
    data: {
      responses: [
        {
          countryCode: "US",
          questionKey: "veteran",
          definitionVersion: "vs-us-1",
          answer: { state: "answered", code: "yes" },
        },
      ],
    },
  })
  input.sourceStamp = (
    await services.autofill.prepare({ resumeId: input.sourceStamp.resumeId })
  ).sourceStamp
  input.countryCode = "US"
  input.snapshot.fields = [field({ label: "Protected veteran status" })]
  expect((await services.autofill.plan(input)).decisions[0]?.status).toBe(
    "missing_data"
  )
})
it("rejects a forged record choice and a changed option binding", async () => {
  const { services, input, ports } = await setup()
  input.selections = [
    {
      fieldId: "email",
      fieldRevision: 1,
      concept: "contact_email",
      recordId: "foreign-record",
      confirmed: true,
      replace: false,
      guardRef: "guard",
      profileRevision: 0,
    },
  ]
  expect((await services.autofill.plan(input)).plan.actions).toEqual([])
  input.selections = []
  ports.autofillPolicy.value.autoRules = ["label:contact_email"]
  input.snapshot.fields = [
    field({
      control: "single_select",
      capabilities: { ...field().capabilities, discover: true },
      options: {
        fieldId: "email",
        fieldRevision: 1,
        optionsRevision: 1,
        queryRevision: 1,
        query: "old",
        loadState: "ready",
        coverage: "partial",
        hasMore: null,
        canSearch: true,
        canScroll: false,
        options: [],
        bindingRef: { semanticKey: "contact_email", factId: "different-fact" },
      },
    }),
  ]
  const result = await services.autofill.plan(input)
  expect(result.plan.actions).toEqual([])
  expect(result.decisions[0]?.reasonCode).toBe("binding_changed")
})
it("requires a complete, non-contradictory multiselect confirmation", async () => {
  const { services, input } = await setup()
  input.snapshot.fields = [
    field({
      control: "multi_select",
      options: {
        fieldId: "email",
        fieldRevision: 1,
        optionsRevision: 1,
        queryRevision: 1,
        query: "",
        loadState: "ready",
        coverage: "complete",
        hasMore: false,
        canSearch: false,
        canScroll: false,
        options: ["None", "applicant@example.test"].map((label, index) => ({
          optionId: String(index),
          label,
          description: "",
          disabled: false,
          placeholder: false,
          selected: false,
        })),
      },
    }),
  ]
  input.selections = [
    {
      fieldId: "email",
      fieldRevision: 1,
      concept: "contact_email",
      confirmed: true,
      replace: false,
      guardRef: "guard",
      profileRevision: 0,
      optionsRevision: 1,
      queryRevision: 1,
      optionIds: ["0", "1"],
    },
  ]
  expect((await services.autofill.plan(input)).plan.actions).toEqual([])
  const selected = input.selections[0]
  if (!selected) throw new Error("Missing selection")
  input.selections[0] = { ...selected, optionIds: ["1"] }
  expect((await services.autofill.plan(input)).plan.actions[0]).toMatchObject({
    op: "set_multiple",
    optionIds: ["1"],
  })
})
it("does not send a saved EEO value even when the label and options require review", async () => {
  const { services, input, ports } = await setup()
  await services.autofillProfile.update({
    expectedRevision: 0,
    section: "eeo",
    data: {
      responses: [
        {
          countryCode: "US",
          questionKey: "gender",
          definitionVersion: "vs-us-1",
          answer: {
            state: "answered",
            code: "self_described",
            text: "Private identity sentinel",
          },
        },
      ],
    },
  })
  input.sourceStamp = (
    await services.autofill.prepare({ resumeId: input.sourceStamp.resumeId })
  ).sourceStamp
  input.countryCode = "US"
  input.snapshot.fields = [field({ label: "Optional gender classification" })]
  ports.autofillPolicy.value.jevEnabled = true
  ports.autofillDecider.answers = [
    {
      id: "email",
      choice: "eeo_gender",
      probability: 1,
      margin: 1,
      tied: false,
    },
  ]
  expect((await services.autofill.plan(input)).plan.actions).toEqual([])
  expect(JSON.stringify(ports.autofillDecider.calls)).not.toContain(
    "Private identity sentinel"
  )
})
it("does not substitute recent employment for a current employer", async () => {
  const { services, input, resume } = await setup()
  const current = await services.resumes.get(resume.id)
  const doc = structuredClone(current.data)
  for (const item of doc.sections.flatMap((s) => s.items))
    if (item.kind === "experience") item.end = "2025-01"
  await services.resumes.update({ id: resume.id, data: doc })
  input.sourceStamp = (
    await services.autofill.prepare({ resumeId: resume.id })
  ).sourceStamp
  input.snapshot.fields = [
    field({ label: "Current employer" }),
    field({ fieldId: "recent", label: "Most recent employer" }),
  ]
  const result = await services.autofill.plan(input)
  expect(result.decisions[0]?.status).toBe("missing_data")
  expect(result.decisions[1]?.value).toBe("Company")
})
it("keeps repeated records explicitly bound and rejects reuse in another group", async () => {
  const { services, input, resume } = await setup()
  const current = await services.resumes.get(resume.id)
  const record = current.data.sections
    .flatMap((s) => s.items)
    .find((i) => i.kind === "experience")
  if (!record) throw new Error("Missing fixture")
  input.snapshot.groups = [
    { groupId: "group-a", label: "Experience", kind: "experience" },
    { groupId: "group-b", label: "Experience", kind: "experience" },
  ]
  input.snapshot.fields = [
    field({ label: "Company", groupId: "group-a", section: "Experience" }),
    field({
      fieldId: "second",
      label: "Company",
      groupId: "group-b",
      section: "Experience",
    }),
  ]
  expect(
    (await services.autofill.plan(input)).decisions.every(
      (d) => d.reasonCode === "choose_record"
    )
  ).toBe(true)
  input.selections = input.snapshot.fields.map((f) => ({
    fieldId: f.fieldId,
    fieldRevision: 1,
    concept: "experience_company",
    recordId: record.id,
    confirmed: true,
    replace: false,
    guardRef: "guard",
    profileRevision: 0,
  }))
  expect((await services.autofill.plan(input)).plan.actions).toEqual([])
})
it("refuses application-country context that conflicts with the actual question", async () => {
  const { services, input } = await setup()
  await services.autofillProfile.update({
    expectedRevision: 0,
    section: "workAuthorization",
    data: [
      {
        countryCode: "CA",
        authorizedToWork: "yes",
        requiresSponsorshipNow: "no",
        requiresSponsorshipFuture: "unknown",
      },
    ],
  })
  input.sourceStamp = (
    await services.autofill.prepare({ resumeId: input.sourceStamp.resumeId })
  ).sourceStamp
  input.countryCode = "CA"
  input.snapshot.fields = [
    field({ label: "Are you authorized to work in the United States?" }),
  ]
  expect((await services.autofill.plan(input)).decisions[0]?.reasonCode).toBe(
    "country_scope_conflict"
  )
})
