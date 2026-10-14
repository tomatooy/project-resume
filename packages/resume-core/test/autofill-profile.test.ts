import { describe, expect, it } from "vitest"
import { profileFieldValue } from "../src/dom-agent/saved-answer"
import { createServices } from "../src/services/container"
import { inMemoryPorts } from "../src/testing/ports"

/**
 * The distinctions the Profile has to keep. Each one is a pair of states that a
 * form is tempted to collapse, and collapsing either is wrong even when the
 * interface still looks right.
 */

const UNAUTHORIZED = {
  countryCode: "US",
  authorizedToWork: "unknown",
  requiresSponsorshipNow: "unknown",
  requiresSponsorshipFuture: "unknown",
} as const

function services() {
  return createServices(inMemoryPorts())
}

describe("work authorization keeps country and time scope", () => {
  it("separates unknown from an explicit no", async () => {
    const app = services()
    const current = await app.autofillProfile.get()
    const updated = await app.autofillProfile.update({
      expectedRevision: current.revision,
      section: "workAuthorization",
      data: [
        {
          countryCode: "US",
          authorizedToWork: "no",
          requiresSponsorshipNow: "unknown",
          requiresSponsorshipFuture: "yes",
        },
      ],
    })
    const row = updated.data.workAuthorization[0]
    expect(row?.authorizedToWork).toBe("no")
    // The two nobody answered stay unknown rather than becoming a no.
    expect(row?.requiresSponsorshipNow).toBe("unknown")
    expect(row?.requiresSponsorshipFuture).toBe("yes")
    expect(row?.countryCode).toBe("US")
  })

  it("carries a confirmation time only when something was answered", async () => {
    const app = services()
    const current = await app.autofillProfile.get()
    const unanswered = await app.autofillProfile.update({
      expectedRevision: current.revision,
      section: "workAuthorization",
      data: [UNAUTHORIZED],
    })
    // Nothing asserted, nothing claimed: an unanswered row is not a confirmed
    // answer that happens to read as unknown.
    expect(unanswered.data.workAuthorization[0]?.confirmedAt).toBeUndefined()
    const answered = await app.autofillProfile.update({
      expectedRevision: unanswered.revision,
      section: "workAuthorization",
      data: [{ ...UNAUTHORIZED, authorizedToWork: "yes" }],
    })
    expect(answered.data.workAuthorization[0]?.confirmedAt).toBeTruthy()
    expect(answered.data.workAuthorization[0]?.countryCode).toBe("US")
  })

  it("keeps one row per country", async () => {
    const app = services()
    const current = await app.autofillProfile.get()
    const updated = await app.autofillProfile.update({
      expectedRevision: current.revision,
      section: "workAuthorization",
      data: [
        { ...UNAUTHORIZED, authorizedToWork: "yes" },
        {
          countryCode: "PT",
          authorizedToWork: "yes",
          requiresSponsorshipNow: "no",
          requiresSponsorshipFuture: "no",
        },
      ],
    })
    expect(
      updated.data.workAuthorization.map((row) => row.countryCode)
    ).toEqual(["US", "PT"])
  })
})

describe("salary keeps amount, currency and period apart", () => {
  it("stores the three separately and hands a control the number", async () => {
    const app = services()
    const current = await app.autofillProfile.get()
    const updated = await app.autofillProfile.update({
      expectedRevision: current.revision,
      section: "preferences",
      data: {
        ...current.data.preferences,
        salaryAmount: 145000,
        salaryCurrency: "USD",
        salaryPeriod: "year",
      },
    })
    expect(updated.data.preferences.salaryAmount).toBe(145000)
    expect(updated.data.preferences.salaryCurrency).toBe("USD")
    expect(updated.data.preferences.salaryPeriod).toBe("year")
    // What the control receives is the numeric representation, never the way
    // the figure reads to a person.
    expect(
      profileFieldValue(
        { type: "money", amount: 145000, currency: "USD", period: "year" },
        { section: "preferences", field: "salaryAmount" }
      )
    ).toEqual({ salaryAmount: 145000 })
    expect(() =>
      profileFieldValue(
        { type: "text", text: "$145,000 per year" },
        { section: "preferences", field: "salaryAmount" }
      )
    ).toThrow()
  })

  it("leaves an unknown period distinguishable from a chosen one", async () => {
    const app = services()
    const current = await app.autofillProfile.get()
    expect(current.data.preferences.salaryPeriod).toBe("unknown")
    expect(current.data.preferences.salaryAmount).toBeNull()
  })
})

describe("EEO keeps unanswered, declined and answered apart", () => {
  it("stores three distinct states with the right confirmation times", async () => {
    const app = services()
    const current = await app.autofillProfile.get()
    const updated = await app.autofillProfile.update({
      expectedRevision: current.revision,
      section: "eeo",
      data: {
        responses: [
          {
            countryCode: "US",
            questionKey: "gender",
            definitionVersion: "vs-us-1",
            answer: { state: "unanswered" },
          },
          {
            countryCode: "US",
            questionKey: "race_ethnicity",
            definitionVersion: "vs-us-1",
            answer: { state: "decline_to_answer" },
          },
          {
            countryCode: "US",
            questionKey: "disability",
            definitionVersion: "vs-us-1",
            answer: { state: "answered", code: "no" },
          },
        ],
      },
    })
    expect(updated.data.eeo.responses.map((row) => row.answer.state)).toEqual([
      "unanswered",
      "decline_to_answer",
      "answered",
    ])
    // Unanswered is not a decision, so it carries no confirmation time.
    expect(updated.data.eeo.responses[0]?.confirmedAt).toBeUndefined()
    expect(updated.data.eeo.responses[1]?.confirmedAt).toBeTruthy()
    expect(updated.data.eeo.responses[2]?.confirmedAt).toBeTruthy()
  })
})
