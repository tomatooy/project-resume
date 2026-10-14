import { describe, expect, it } from "vitest"
import { ActionSchema } from "../src/dom-agent/action"
import {
  StoredAnswerSchema,
  answerDestination,
  factFromStoredAnswer,
  scopeFromConditions,
} from "../src/dom-agent/saved-answer"
import { SourcePreparationSchema } from "../src/dom-agent/source-service"
import { createServices } from "../src/services/container"
import { inMemoryPorts } from "../src/testing/ports"

const QUESTION_KEY = "0123456789abcdef"

async function setup() {
  const ports = inMemoryPorts()
  const services = createServices(ports)
  const created = await services.resumes.create()
  const resume = await services.resumes.get(created.id)
  return { ports, services, resume }
}

/** The legacy row shape: no question key, so no question identity. */
function legacy(over: Record<string, unknown> = {}) {
  return StoredAnswerSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    revision: 2,
    meaning: { concept: "country" },
    conditions: { countryCode: "US" },
    value: "United States",
    provenance: { kind: "user" },
    confirmedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  })
}

function refusal(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error("expected a refusal")
}

describe("the source bundle", () => {
  it("derives one bundle from the resume, the profile and the stored answers", async () => {
    const { services, resume } = await setup()
    const prepared = await services.autofill.prepare({ resumeId: resume.id })
    expect(SourcePreparationSchema.safeParse(prepared).success).toBe(true)
    expect(prepared.bundle.resumeId).toBe(resume.id)
    expect(prepared.bundle.resumeVersionId).toBeNull()
    expect(prepared.bundle.sources.map((source) => source.kind).sort()).toEqual(
      ["profile", "resume", "saved_answers"]
    )
    expect(
      prepared.bundle.facts.some((fact) => fact.source.kind === "resume")
    ).toBe(true)
    expect(prepared.bundle.render.templateId).toBe(resume.templateId)
    expect(prepared.review).toEqual([])
  })

  it("never carries an EEO answer into the bundle, even a confirmed one", async () => {
    const { services, resume } = await setup()
    const profile = await services.autofillProfile.get()
    await services.autofillProfile.update({
      expectedRevision: profile.revision,
      section: "eeo",
      data: {
        responses: [
          {
            countryCode: "US",
            questionKey: "gender",
            definitionVersion: "vs-us-1",
            answer: { state: "answered", code: "woman" },
          },
          {
            countryCode: "US",
            questionKey: "veteran",
            definitionVersion: "vs-us-1",
            answer: { state: "decline_to_answer" },
          },
        ],
      },
    })
    // The Profile really holds them, so the assertion below is about the bundle
    // rather than about a section that silently failed to save.
    const stored = await services.autofillProfile.get()
    expect(
      stored.data.eeo.responses.filter(
        (row) => row.answer.state !== "unanswered"
      )
    ).toHaveLength(2)
    const { bundle } = await services.autofill.prepare({ resumeId: resume.id })
    expect(
      bundle.facts.filter((fact) => fact.id.startsWith("profile:eeo"))
    ).toEqual([])
  })

  it("keeps a salary structured and keeps work authorization in its country", async () => {
    const { services, resume } = await setup()
    const profile = await services.autofillProfile.get()
    await services.autofillProfile.update({
      expectedRevision: profile.revision,
      section: "preferences",
      data: {
        ...profile.data.preferences,
        salaryAmount: 145000,
        salaryCurrency: "USD",
        salaryPeriod: "year",
      },
    })
    await services.autofillProfile.update({
      expectedRevision: profile.revision + 1,
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
    const { bundle } = await services.autofill.prepare({ resumeId: resume.id })
    const salary = bundle.facts.find(
      (fact) => fact.id === "profile:preferences.salary"
    )
    expect(salary?.value).toEqual({
      type: "money",
      amount: 145000,
      currency: "USD",
      period: "year",
    })
    const authorized = bundle.facts.find(
      (fact) => fact.id === "profile:workAuthorization.authorizedToWork.US"
    )
    expect(authorized?.value).toEqual({ type: "boolean", state: "yes" })
    expect(authorized?.scope).toEqual([{ dimension: "country", value: "US" }])
  })

  it("leaves the held bundle alone when the main app edits a source", async () => {
    const { ports, services, resume } = await setup()
    const held = await services.autofill.prepare({ resumeId: resume.id })
    const write = await ports.resumes.updateData({
      id: resume.id,
      schemaVersion: 1,
      data: {
        ...resume.data,
        basics: { ...resume.data.basics, name: "A Later Edit" },
      },
    })
    expect(write.ok).toBe(true)

    // What the caller already holds did not change under it.
    expect(
      held.bundle.facts.find((fact) => fact.id === "resume:basics.name")?.value
    ).toEqual({ type: "text", text: resume.data.basics.name })

    // Naming the old bundle is how a caller learns its sources moved.
    await expect(
      services.autofill.prepare({
        resumeId: resume.id,
        expectedBundleId: held.bundle.id,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })

    const fresh = await services.autofill.prepare({ resumeId: resume.id })
    expect(fresh.bundle.id).not.toBe(held.bundle.id)
    expect(
      fresh.bundle.facts.find((fact) => fact.id === "resume:basics.name")?.value
    ).toEqual({ type: "text", text: "A Later Edit" })
  })

  it("treats a bundle id as a check, never as a way to supply sources", async () => {
    const { services, resume } = await setup()
    const first = await services.autofill.prepare({ resumeId: resume.id })
    const again = await services.autofill.prepare({
      resumeId: resume.id,
      expectedBundleId: first.bundle.id,
    })
    expect(again.bundle).toEqual(first.bundle)
    await expect(
      services.autofill.prepare({
        resumeId: resume.id,
        sources: [],
        facts: [],
        render: first.bundle.render,
      })
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("can pin a stored version, and refuses one that belongs elsewhere", async () => {
    const { ports, services, resume } = await setup()
    const version = await ports.versions.create({
      resumeId: resume.id,
      content: resume.data,
      schemaVersion: 1,
      contentHash: "a".repeat(64),
      label: "Saved",
      createdBy: "user",
    })
    const prepared = await services.autofill.prepare({
      resumeId: resume.id,
      versionId: version.version.id,
    })
    expect(prepared.bundle.resumeVersionId).toBe(version.version.id)
    expect(
      prepared.bundle.sources.find((source) => source.kind === "resume")?.id
    ).toBe(version.version.id)

    const other = await services.resumes.create()
    await expect(
      services.autofill.prepare({
        resumeId: other.id,
        versionId: version.version.id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})

describe("stored answers without a question identity", () => {
  it("surfaces them for review instead of generalizing them", async () => {
    const { services, resume } = await setup()
    const saved = await services.autofillAnswers.save({
      expectedRevision: 0,
      confirmed: true,
      meaning: { concept: "country" },
      conditions: { countryCode: "US" },
      value: "United States",
      provenance: { kind: "user" },
    })
    const { bundle, review } = await services.autofill.prepare({
      resumeId: resume.id,
    })
    expect(review).toHaveLength(1)
    expect(review[0]).toMatchObject({
      answerId: saved.id,
      reason: "no_question_key",
      value: "United States",
      scope: [{ dimension: "country", value: "US" }],
    })
    expect(
      bundle.facts.some((fact) => fact.source.kind === "saved_answer")
    ).toBe(false)
    // Retained for the user, not deleted or folded into a general answer.
    expect(
      (await services.autofillAnswers.list()).map((row) => row.id)
    ).toEqual([saved.id])
  })

  it("turns a keyed answer into a fact that cites its question", () => {
    const outcome = factFromStoredAnswer(
      legacy({
        meaning: { concept: "work_authorized" },
        value: "yes",
        questionKey: QUESTION_KEY,
        factValue: { type: "boolean", state: "yes" },
      })
    )
    if (outcome.kind !== "fact") throw new Error("expected a source fact")
    expect(outcome.fact.source).toEqual({
      kind: "saved_answer",
      answerId: "11111111-1111-4111-8111-111111111111",
      questionKey: QUESTION_KEY,
    })
    expect(outcome.fact.value).toEqual({ type: "boolean", state: "yes" })
    expect(outcome.fact.scope).toEqual([{ dimension: "country", value: "US" }])
  })

  it("keeps an EEO answer reviewable even when it carries a structured value", () => {
    // The mirror of the Profile-side exclusion. A row with the concept identity
    // the retired engine demanded, the new question identity and a value the
    // vocabulary can express would otherwise become an eligible source.
    for (const concept of ["eeo_gender", "eeo_veteran"]) {
      const outcome = factFromStoredAnswer(
        legacy({
          meaning: {
            concept,
            questionKey: concept.replace("eeo_", ""),
            definitionVersion: "vs-us-1",
          },
          value: "woman",
          questionKey: QUESTION_KEY,
          factValue: { type: "text", text: "woman" },
        })
      )
      if (outcome.kind !== "review") throw new Error("expected review")
      expect(outcome.answer.reason).toBe("excluded_concept")
    }
  })

  it("keeps a keyed answer reviewable when it holds only a display string", () => {
    const outcome = factFromStoredAnswer(
      legacy({
        meaning: { concept: "salary" },
        conditions: {
          countryCode: "US",
          currency: "USD",
          salaryPeriod: "year",
        },
        value: "145000 USD / year",
        questionKey: QUESTION_KEY,
      })
    )
    if (outcome.kind !== "review") throw new Error("expected review")
    expect(outcome.answer.reason).toBe("unsupported_value")
  })

  it("spells stored conditions out as scope", () => {
    expect(
      scopeFromConditions({
        countryCode: "US",
        currency: "USD",
        salaryPeriod: "year",
        employerId: "acme",
        jobId: "42",
      })
    ).toEqual([
      { dimension: "country", value: "US" },
      { dimension: "employer", value: "acme" },
      { dimension: "currency", value: "USD" },
      { dimension: "period", value: "year" },
      { dimension: "other", value: "job:42" },
    ])
  })
})

describe("the PDF document", () => {
  it("identifies a PDF by the bundle, the template and the render assets", async () => {
    const { ports, services, resume } = await setup()
    const prepared = await services.autofill.prepare({ resumeId: resume.id })
    const first = await services.autofill.document({
      resumeId: resume.id,
      bundleId: prepared.bundle.id,
    })
    const again = await services.autofill.document({
      resumeId: resume.id,
      bundleId: prepared.bundle.id,
    })
    expect(again.pdfId).toBe(first.pdfId)

    // The template is not an answer, so it does not move the bundle, but it
    // does move the bytes, which the retired source stamp could not express.
    await ports.resumes.setTemplate(
      resume.id,
      "meridian",
      resume.templateOptions
    )
    const reprepared = await services.autofill.prepare({ resumeId: resume.id })
    expect(reprepared.bundle.id).toBe(prepared.bundle.id)
    const retemplated = await services.autofill.document({
      resumeId: resume.id,
      bundleId: reprepared.bundle.id,
    })
    expect(retemplated.pdfId).not.toBe(first.pdfId)
  })

  it("refuses a PDF whose pinned bundle no longer matches", async () => {
    const { ports, services, resume } = await setup()
    const prepared = await services.autofill.prepare({ resumeId: resume.id })
    await ports.resumes.updateData({
      id: resume.id,
      schemaVersion: 1,
      data: {
        ...resume.data,
        basics: { ...resume.data.basics, name: "A Later Edit" },
      },
    })
    await expect(
      services.autofill.document({
        resumeId: resume.id,
        bundleId: prepared.bundle.id,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("returns the document and its render inputs, with no Profile data", async () => {
    const { services, resume } = await setup()
    const profile = await services.autofillProfile.get()
    await services.autofillProfile.update({
      expectedRevision: profile.revision,
      section: "identity",
      data: {
        ...profile.data.identity,
        legalGivenName: "Private-Profile-Value",
        phone: "+1 555 0100",
      },
    })
    const prepared = await services.autofill.prepare({ resumeId: resume.id })
    const document = await services.autofill.document({
      resumeId: resume.id,
      bundleId: prepared.bundle.id,
    })
    expect(Object.keys(document).sort()).toEqual([
      "bundleId",
      "pdfId",
      "render",
      "resume",
    ])
    expect(JSON.stringify(document)).not.toContain("Private-Profile-Value")
  })
})

describe("keeping a confirmed answer", () => {
  it("defaults to this application only", () => {
    expect(answerDestination()).toEqual({ kind: "application" })
    expect(
      refusal(() =>
        answerDestination({ keep: "reusable", questionKey: QUESTION_KEY })
      )
    ).toMatchObject({ code: "VALIDATION" })
    expect(
      refusal(() =>
        answerDestination({ keep: "profile", questionKey: QUESTION_KEY })
      )
    ).toMatchObject({ code: "VALIDATION" })
    expect(
      refusal(() => answerDestination({ keep: "reusable" }))
    ).toMatchObject({ code: "VALIDATION" })
    expect(
      answerDestination({
        keep: "reusable",
        questionKey: QUESTION_KEY,
        scope: [{ dimension: "employer", value: "acme" }],
      })
    ).toEqual({
      kind: "reusable",
      questionKey: QUESTION_KEY,
      scope: [{ dimension: "employer", value: "acme" }],
    })
  })

  it("writes only into a Profile field the Profile declares", async () => {
    const { services } = await setup()
    const saved = await services.autofill.saveToProfile({
      target: { kind: "field", section: "identity", field: "phone" },
      value: { type: "text", text: "+1 555 0100" },
      expectedRevision: 0,
    })
    expect(saved.data.identity.phone).toBe("+1 555 0100")
    expect(saved.revision).toBe(1)

    await expect(
      services.autofill.saveToProfile({
        target: { kind: "field", section: "identity", field: "phone" },
        value: { type: "text", text: "+1 555 0199" },
        expectedRevision: 0,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })

    await expect(
      services.autofill.saveToProfile({
        target: { kind: "field", section: "identity", field: "nickname" },
        value: { type: "text", text: "Ada" },
        expectedRevision: 1,
      })
    ).rejects.toMatchObject({ code: "VALIDATION" })

    await expect(
      services.autofill.saveToProfile({
        target: { kind: "field", section: "identity", field: "phone" },
        value: { type: "money", amount: 1, currency: "USD", period: "year" },
        expectedRevision: 1,
      })
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("keeps salary as an amount, a currency and a period together", async () => {
    const { services } = await setup()
    const saved = await services.autofill.saveToProfile({
      target: { kind: "salary" },
      value: { type: "money", amount: 145000, currency: "USD", period: "year" },
      expectedRevision: 0,
    })
    expect(saved.data.preferences.salaryAmount).toBe(145000)
    expect(saved.data.preferences.salaryCurrency).toBe("USD")
    expect(saved.data.preferences.salaryPeriod).toBe("year")
    await expect(
      services.autofill.saveToProfile({
        target: { kind: "salary" },
        value: { type: "text", text: "145000" },
        expectedRevision: 1,
      })
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })
})

describe("what may cross to a page", () => {
  it("carries a value or an authorized attachment, and nothing else", () => {
    const written = ActionSchema.parse({
      ref: "a1",
      questionRef: "q1",
      type: "write_text",
      value: "Ada",
      expectedValue: null,
    })
    expect(Object.keys(written).sort()).toEqual([
      "expectedValue",
      "questionRef",
      "ref",
      "type",
      "value",
    ])
    const attached = ActionSchema.parse({
      ref: "a2",
      questionRef: "q2",
      type: "attach_file",
      pdfIdentity: QUESTION_KEY,
      replaceExisting: false,
      replacementConfirmedAt: null,
    })
    expect(Object.keys(attached).sort()).toEqual([
      "pdfIdentity",
      "questionRef",
      "ref",
      "replaceExisting",
      "replacementConfirmedAt",
      "type",
    ])
    for (const option of ActionSchema.options)
      for (const forbidden of [
        "fact",
        "facts",
        "meaning",
        "display",
        "scope",
        "sources",
        "bundle",
      ])
        expect(Object.keys(option.shape)).not.toContain(forbidden)
  })
})
