import {
  RemoveSavedAnswerSchema,
  SaveSavedAnswerSchema,
  SavedAnswerSchema,
  SavedAnswerService,
  displayOfSavedValue,
  factFromSavedAnswer,
  isDemographicQuestion,
  savedQuestionKey,
  type SavedAnswer,
  type SavedAnswerRepository,
  type SavedQuestionEvidence,
} from "../src"
import {
  StoredAnswerSchema,
  reviewFromStoredAnswer,
} from "../src/dom-agent/saved-answer"
import { FactSchema } from "../src/dom-agent/source"
import { describe, expect, it } from "vitest"

const ID = "11111111-1111-4111-8111-111111111111"
const US = { dimension: "country", value: "US" } as const
const TODAY = { dimension: "time", value: "2026-10-14" } as const

class MemoryRepository implements SavedAnswerRepository {
  rows = new Map<string, SavedAnswer>()
  async list(): Promise<SavedAnswer[]> {
    return [...this.rows.values()]
  }
  async save(
    answer: SavedAnswer,
    expectedRevision: number
  ): Promise<SavedAnswer | null> {
    const existing = this.rows.get(answer.id)
    if (
      expectedRevision === 0
        ? existing
        : existing?.revision !== expectedRevision
    )
      return null
    this.rows.set(answer.id, answer)
    return answer
  }
  async remove(id: string, expectedRevision: number): Promise<boolean> {
    const existing = this.rows.get(id)
    if (!existing || existing.revision !== expectedRevision) return false
    this.rows.delete(id)
    return true
  }
}

function service(repository = new MemoryRepository()) {
  return { repository, answers: new SavedAnswerService(repository) }
}

/** A question no vocabulary carries: the case the whole ticket exists for. */
function noticePeriod(
  over: Partial<SavedQuestionEvidence> = {}
): SavedQuestionEvidence {
  return {
    text: "How much notice do you need to give your current employer?",
    kind: "short_text",
    scope: [{ dimension: "employer", value: "Acme" }],
    options: [],
    ...over,
  }
}

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    if (error instanceof Error) return error.message
    throw error
  }
  throw new Error("expected a refusal")
}

describe("saved answers in the question's own shape", () => {
  it("saves, reloads, edits and removes a company-specific answer", async () => {
    const { answers } = service()
    const saved = await answers.save({
      expectedRevision: 0,
      question: noticePeriod(),
      value: { type: "text", text: "Four weeks" },
      confirmed: true,
    })
    // Reloaded: the wording is the page's, not a label built from a vocabulary.
    const [reloaded] = await answers.list()
    expect(reloaded?.question.text).toBe(noticePeriod().text)
    expect(reloaded?.question.key).toBe(savedQuestionKey(noticePeriod()))
    // Edited: the value changes, the identity does not.
    const edited = await answers.save({
      id: saved.id,
      expectedRevision: saved.revision,
      question: noticePeriod(),
      value: { type: "text", text: "Six weeks" },
      confirmed: true,
    })
    expect(edited.value).toEqual({ type: "text", text: "Six weeks" })
    expect(edited.question.key).toBe(saved.question.key)
    expect(edited.revision).toBe(2)
    await answers.remove({ id: edited.id, expectedRevision: edited.revision })
    expect(await answers.list()).toEqual([])
  })

  it("has no concept anywhere in the path", () => {
    // The whole point: a caller cannot file this question under a vocabulary
    // member, and cannot name its own identity either.
    expect(
      SaveSavedAnswerSchema.safeParse({
        expectedRevision: 0,
        question: {
          ...noticePeriod(),
          concept: "open_answer",
          key: "a".repeat(16),
        },
        value: { type: "text", text: "Four weeks" },
        confirmed: true,
      }).success
    ).toBe(false)
    expect(
      SavedAnswerSchema.safeParse({
        id: ID,
        revision: 1,
        question: { ...noticePeriod(), key: savedQuestionKey(noticePeriod()) },
        value: { type: "text", text: "Four weeks" },
        confirmedAt: "2026-10-14T00:00:00.000Z",
        updatedAt: "2026-10-14T00:00:00.000Z",
      }).success
    ).toBe(true)
  })

  it("derives the identity from the question rather than trusting a caller", async () => {
    const { answers } = service()
    const saved = await answers.save({
      expectedRevision: 0,
      question: noticePeriod(),
      value: { type: "text", text: "Four weeks" },
      confirmed: true,
    })
    // Scope is meaning, so the same wording under another employer is another
    // answer with another identity.
    const other = await answers.save({
      expectedRevision: 0,
      question: noticePeriod({
        scope: [{ dimension: "employer", value: "Globex" }],
      }),
      value: { type: "text", text: "Two weeks" },
      confirmed: true,
    })
    expect(other.question.key).not.toBe(saved.question.key)
    expect(saved.question.key).toHaveLength(16)
  })

  it("refuses to save for reuse without an explicit scope, and says why", async () => {
    const { answers } = service()
    const message = await refusal(() =>
      answers.save({
        expectedRevision: 0,
        question: noticePeriod({ scope: [] }),
        value: { type: "text", text: "Four weeks" },
        confirmed: true,
      })
    )
    expect(message).toContain("scope")
  })

  it("keeps country and time scope for a work authorization answer", async () => {
    const { answers } = service()
    const question: SavedQuestionEvidence = {
      text: "Are you authorized to work in the United States?",
      kind: "yes_no",
      scope: [US, TODAY],
      options: [],
    }
    const saved = await answers.save({
      expectedRevision: 0,
      question,
      value: { type: "boolean", state: "yes" },
      confirmed: true,
    })
    expect(saved.question.scope).toEqual([US, TODAY])
    // An answer given for one time is not the answer for another.
    const later = await answers.save({
      expectedRevision: 0,
      question: {
        ...question,
        scope: [US, { dimension: "time", value: "2027-01-01" }],
      },
      value: { type: "boolean", state: "yes" },
      confirmed: true,
    })
    expect(later.question.key).not.toBe(saved.question.key)
  })

  it("reads back as a source fact that cites its own identity", async () => {
    const { answers } = service()
    const saved = await answers.save({
      expectedRevision: 0,
      question: noticePeriod(),
      value: { type: "text", text: "Four weeks" },
      confirmed: true,
    })
    const outcome = factFromSavedAnswer(saved)
    if (outcome.kind !== "fact") throw new Error("expected a source fact")
    // The fact is a protocol fact: provenance has to name a real identity.
    expect(() => FactSchema.parse(outcome.fact)).not.toThrow()
    expect(outcome.fact.source).toEqual({
      kind: "saved_answer",
      answerId: saved.id,
      questionKey: saved.question.key,
    })
    // The meaning is the question's own wording, which is what a page matches.
    expect(outcome.fact.meaning).toBe(noticePeriod().text)
    expect(outcome.fact.scope).toEqual(noticePeriod().scope)
    expect(displayOfSavedValue(saved.value)).toBe("Four weeks")
  })

  it("records the decision and refuses to source a row that excludes it", async () => {
    const { answers } = service()
    const saved = await answers.save({
      expectedRevision: 0,
      question: noticePeriod(),
      value: { type: "text", text: "Four weeks" },
      confirmed: true,
    })
    // A written row carries the decision, so a reader never re-derives it from
    // wording. The refusal the save path already made is what makes it false.
    expect(saved.question.excluded).toBe(false)
    for (const excluded of [true, undefined]) {
      const row = SavedAnswerSchema.parse({
        ...saved,
        question: { ...saved.question, excluded },
      })
      const outcome = factFromSavedAnswer(row)
      if (outcome.kind !== "review") throw new Error("expected a refusal")
      expect(outcome.answer).toMatchObject({
        answerId: saved.id,
        revision: saved.revision,
        meaning: noticePeriod().text,
        value: "Four weeks",
        scope: noticePeriod().scope,
        reason: "excluded_concept",
      })
    }
  })

  it("keeps amount, currency and period apart on a salary answer", async () => {
    const { answers } = service()
    const saved = await answers.save({
      expectedRevision: 0,
      question: {
        text: "What is your expected annual salary?",
        kind: "number",
        scope: [
          { dimension: "currency", value: "USD" },
          { dimension: "period", value: "year" },
        ],
        options: [],
      },
      value: { type: "money", amount: 145000, currency: "USD", period: "year" },
      confirmed: true,
    })
    expect(saved.value).toEqual({
      type: "money",
      amount: 145000,
      currency: "USD",
      period: "year",
    })
  })

  it("refuses a question the page generated rather than authored", async () => {
    const { answers } = service()
    const message = await refusal(() =>
      answers.save({
        expectedRevision: 0,
        question: noticePeriod({ text: "[unlabelled short_text]" }),
        value: { type: "text", text: "Four weeks" },
        confirmed: true,
      })
    )
    expect(message).toContain("no wording of its own")
  })

  it("never saves a demographic question for reuse", async () => {
    const { answers } = service()
    expect(isDemographicQuestion(noticePeriod())).toBe(false)
    for (const text of [
      "Gender identity",
      "Have you served in the US military?",
      "Disability status",
      "How do you self-identify?",
    ])
      expect(isDemographicQuestion({ text, options: [] })).toBe(true)
    const message = await refusal(() =>
      answers.save({
        expectedRevision: 0,
        question: noticePeriod({ text: "Gender identity", scope: [US] }),
        value: { type: "text", text: "woman" },
        confirmed: true,
      })
    )
    expect(message).toContain("never reused")
  })

  it("reads a demographic question from its answer categories as well", () => {
    // A page can ask about gender without using the word, and still offer the
    // Profile's own categories as the answers.
    expect(
      isDemographicQuestion({
        text: "Which of these best describes you?",
        options: [
          { label: "Woman" },
          { label: "Man" },
          { label: "Non-binary" },
        ],
      })
    ).toBe(true)
    // Yes and No are options on ordinary questions, so the definitions that are
    // a yes or a no take no part in this signal.
    expect(
      isDemographicQuestion({
        text: "Do you have a valid driver's licence?",
        options: [{ label: "Yes" }, { label: "No" }],
      })
    ).toBe(false)
    expect(
      isDemographicQuestion({
        text: noticePeriod().text,
        options: [{ label: "Two weeks" }, { label: "A month" }],
      })
    ).toBe(false)
  })

  it("refuses an answer that holds no answer", async () => {
    const { answers } = service()
    const empty = await refusal(() =>
      answers.save({
        expectedRevision: 0,
        question: noticePeriod(),
        value: { type: "text", text: "   " },
        confirmed: true,
      })
    )
    expect(empty).toContain("empty answer")
    // Unknown is the absence of a fact, not a fact about the applicant.
    const unknown = await refusal(() =>
      answers.save({
        expectedRevision: 0,
        question: { ...noticePeriod(), kind: "yes_no" },
        value: { type: "boolean", state: "unknown" },
        confirmed: true,
      })
    )
    expect(unknown).toContain("absence of an answer")
  })

  it("refuses a choice answer, whose options belong to a page", async () => {
    const { answers } = service()
    const message = await refusal(() =>
      answers.save({
        expectedRevision: 0,
        question: {
          text: "Which office do you prefer?",
          kind: "single_choice",
          scope: [US],
          options: [{ label: "Lisbon" }, { label: "Porto" }],
        },
        value: { type: "choice", optionIds: ["Lisbon"] },
        confirmed: true,
      })
    )
    expect(message).toContain("page offers")
  })

  it("reports a concurrent change as a conflict rather than overwriting", async () => {
    const { answers } = service()
    const saved = await answers.save({
      expectedRevision: 0,
      question: noticePeriod(),
      value: { type: "text", text: "Four weeks" },
      confirmed: true,
    })
    const save = await refusal(() =>
      answers.save({
        id: saved.id,
        expectedRevision: 0,
        question: noticePeriod(),
        value: { type: "text", text: "Later" },
        confirmed: true,
      })
    )
    expect(save).toContain("Reload")
    const remove = await refusal(() =>
      answers.remove({ id: saved.id, expectedRevision: saved.revision + 1 })
    )
    expect(remove).toContain("Reload")
    // An update has to name the row it updates.
    expect(
      SaveSavedAnswerSchema.safeParse({
        expectedRevision: 3,
        question: noticePeriod(),
        value: { type: "text", text: "Four weeks" },
        confirmed: true,
      }).success
    ).toBe(true)
    const noId = await refusal(() =>
      answers.save({
        expectedRevision: 3,
        question: noticePeriod(),
        value: { type: "text", text: "Four weeks" },
        confirmed: true,
      })
    )
    expect(noId).toContain("id")
    expect(RemoveSavedAnswerSchema.safeParse({ id: ID }).success).toBe(false)
  })
})

/** The legacy row shape, written by the vocabulary this ticket retires. */
function legacy(over: Record<string, unknown> = {}) {
  return StoredAnswerSchema.parse({
    id: ID,
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

describe("a legacy row stays readable", () => {
  it("reviews a row whatever free-text key the vocabulary left in it", () => {
    // The retired vocabulary wrote its key inside `meaning`: normalize(label +
    // description). A short one and a long one both used to break the read,
    // which threw where the review exists precisely to avoid that.
    const short = "country"
    const long =
      "are you legally authorized to work in the united states?\nrequired"
    for (const questionKey of [short, long]) {
      const row = legacy({ meaning: { concept: "open_answer", questionKey } })
      expect(reviewFromStoredAnswer(row).reason).toBe("no_question_key")
    }
    // A row carrying no key at all ends in the same place.
    expect(reviewFromStoredAnswer(legacy()).reason).toBe("no_question_key")
  })

  it("cannot be handed the identity that would make it a fact", () => {
    // The reason this reader has no fact to return, pinned so nobody adds one
    // back. The identity a source fact cites is derived from the live page, and
    // the retired payload is the four concept fields and nothing else, so a row
    // trying to carry a top-level identity is refused rather than read.
    expect(() => legacy({ questionKey: "0123456789abcdef" })).toThrow()
  })

  it("reviews a row that holds nothing, and one this version cannot name", () => {
    // An empty row is in the same position as any other legacy row: nothing can
    // name its question, so the reason says that rather than guessing at shape.
    expect(reviewFromStoredAnswer(legacy({ value: "" })).reason).toBe(
      "no_question_key"
    )

    // A concept this version no longer knows cannot be matched safely, so it
    // stays reviewable rather than becoming a fact with a meaningless meaning.
    const unknown = reviewFromStoredAnswer(
      legacy({ meaning: { concept: "concept_from_a_later_release" } })
    )
    expect(unknown.reason).toBe("unsupported_value")
  })

  it("keeps the decision the reason names for an excluded concept", () => {
    const outcome = reviewFromStoredAnswer(
      legacy({
        meaning: { concept: "eeo_gender", definitionVersion: "vs-us-1" },
        value: "woman",
      })
    )
    // The reason is the decision, not the missing identity.
    expect(outcome.reason).toBe("excluded_concept")
  })
})
