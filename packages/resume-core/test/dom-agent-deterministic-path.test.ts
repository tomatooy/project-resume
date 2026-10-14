import { describe, expect, it } from "vitest"
import {
  type AnswerProposal,
  type CandidateQuestion,
  CandidateQuestionSchema,
  type Fact,
  FactSchema,
  type InterpretedPage,
  InterpretationCache,
  type QuestionPlan,
  actionFor,
  exactFactMatch,
  interpretationKey,
  interpretPage,
  optionForFact,
  planAnswers,
  reviewQueue,
} from "@workspace/resume-core/dom-agent"

/**
 * The deterministic path, exercised without a browser and without a model.
 *
 * Fixtures go through the real schemas, so a test cannot pass against a
 * question or a fact shape the engine would refuse.
 */

function question(input: {
  ref?: string
  text: string
  kind?: CandidateQuestion["kind"]
  controlKind?: CandidateQuestion["controlKind"]
  options?: CandidateQuestion["options"]
  requiredness?: CandidateQuestion["requiredness"]
  constraints?: CandidateQuestion["constraints"]
  scope?: CandidateQuestion["scope"]
}): CandidateQuestion {
  const ref = input.ref ?? "q1"
  return CandidateQuestionSchema.parse({
    ref,
    controlRef: `n_${ref}`,
    groupRef: null,
    recordRef: null,
    kind: input.kind ?? "short_text",
    text: input.text,
    description: null,
    options: input.options ?? [],
    requiredness: input.requiredness ?? {
      state: "required",
      evidence: ["native_attribute"],
    },
    controlKind: input.controlKind ?? "text",
    constraints: input.constraints,
    scope: input.scope ?? [],
  })
}

function option(
  label: string,
  selected = false,
  ref = `o_${label.toLowerCase()}`
): CandidateQuestion["options"][number] {
  return {
    ref,
    label,
    value: null,
    selected,
    disabled: false,
  }
}

function fact(input: {
  id?: string
  meaning: string
  display?: string
  value: Fact["value"]
}): Fact {
  return FactSchema.parse({
    id: input.id ?? "f1",
    meaning: input.meaning,
    display: input.display ?? "",
    value: input.value,
    scope: [],
    source: { kind: "profile", section: "contact", field: input.meaning },
  })
}

describe("reading a question", () => {
  it("reads a fact whose meaning matches the page's wording", () => {
    const target = question({ text: "Email address" })
    const facts = [
      fact({
        meaning: "email address",
        value: { type: "text", text: "ada@example.com" },
      }),
    ]
    expect(exactFactMatch(target, facts)?.id).toBe("f1")
  })

  it("reads nothing on a kind this engine inferred rather than read", () => {
    // Ashby's yes/no buttons arrive as button_choice, which the reader knows
    // because it read a role. Answering one deterministically would rest on
    // that inference, so it stays for the model and the gate.
    const buttons = question({
      text: "Are you authorized to work in the US?",
      kind: "single_choice",
      controlKind: "button_choice",
      options: [option("Yes"), option("No")],
    })
    const facts = [
      fact({
        meaning: "are you authorized to work in the us?",
        value: { type: "boolean", state: "yes" },
      }),
    ]
    expect(exactFactMatch(buttons, facts)).toBeNull()
  })

  it("selects the option a yes names, and nothing at all for a decline", () => {
    const target = question({
      text: "Authorized to work in the US?",
      kind: "single_choice",
      controlKind: "radio_group",
      options: [option("Yes"), option("No")],
    })
    const yes = fact({
      meaning: "authorized to work in the us?",
      value: { type: "boolean", state: "yes" },
    })
    const declined = fact({
      id: "f2",
      meaning: "authorized to work in the us?",
      value: { type: "boolean", state: "decline" },
    })
    expect(optionForFact(target, yes)?.label).toBe("Yes")
    // A decline is an answer a person gave. It is not a no, and it selects
    // nothing the page offers.
    expect(optionForFact(target, declined)).toBeNull()
  })

  it("matches a chosen value by the way the page words the option", () => {
    const target = question({
      text: "Country of residence",
      kind: "single_choice",
      controlKind: "select",
      options: [option("Portugal"), option("Spain")],
    })
    const facts = [
      fact({
        meaning: "country of residence",
        display: "Portugal",
        value: { type: "choice", optionIds: ["pt"] },
      }),
    ]
    expect(optionForFact(target, facts[0] as Fact)?.label).toBe("Portugal")
  })
})

describe("reusing a reading", () => {
  it("reuses it for a question whose evidence did not change", () => {
    const cache = new InterpretationCache()
    const first = interpretPage({
      questions: [question({ ref: "q1", text: "Email address" })],
      facts: [
        fact({
          meaning: "email address",
          value: { type: "text", text: "ada@example.com" },
        }),
      ],
      cache,
    })
    expect(first.interpreted).toEqual(["q1"])
    // The page re-rendered: same question, different references.
    const second = interpretPage({
      questions: [question({ ref: "q7", text: "Email address" })],
      facts: [
        fact({
          meaning: "email address",
          value: { type: "text", text: "ada@example.com" },
        }),
      ],
      cache,
    })
    expect(second.reused).toEqual(["q7"])
    expect(second.interpreted).toEqual([])
  })

  it("reads it again when the page's wording changes", () => {
    const cache = new InterpretationCache()
    const facts = [
      fact({
        meaning: "email address",
        value: { type: "text", text: "ada@example.com" },
      }),
    ]
    interpretPage({
      questions: [question({ text: "Email address" })],
      facts,
      cache,
    })
    const changed = interpretPage({
      questions: [question({ text: "Work email address" })],
      facts,
      cache,
    })
    expect(changed.interpreted).toEqual(["q1"])
    expect(changed.reused).toEqual([])
  })

  it("keeps no reusable key for a question the page never worded", () => {
    // Two unlabelled short-text fields would otherwise share one key, and a
    // cached reading would be handed to the wrong question.
    const unlabelled = question({ text: "[unlabelled short_text]" })
    expect(interpretationKey(unlabelled)).toBeNull()
    const cache = new InterpretationCache()
    interpretPage({ questions: [unlabelled], facts: [], cache })
    expect(cache.size).toBe(0)
  })

  /** Plan against a page's readings, so what is under test is the reading. */
  function planRead(
    questions: CandidateQuestion[],
    facts: Fact[],
    readings: InterpretedPage
  ): ReturnType<typeof planAnswers> {
    return planAnswers({
      questions,
      facts,
      seeds: {},
      interpretations: readings.byRef,
    })
  }

  /** What a proposal would select, read by label rather than by reference. */
  function selectedLabels(
    target: CandidateQuestion,
    proposal: AnswerProposal | undefined
  ): string[] {
    const value = proposal?.value
    if (value?.type !== "choice") return []
    return value.optionRefs.map(
      (ref) =>
        target.options.find((entry) => entry.ref === ref)?.label ??
        `(no option is at ${ref})`
    )
  }

  it("selects what the fact names, not the position the reading remembered", () => {
    // The wrong-write case. The reading is reused, and the page has since put a
    // different country at the reference it was read with, so a remembered
    // reference would answer a fact that says Canada with Portugal.
    const cache = new InterpretationCache()
    const facts = [
      fact({
        meaning: "country of residence",
        display: "Canada",
        value: { type: "choice", optionIds: ["ca"] },
      }),
    ]
    const asRead = question({
      text: "Country of residence",
      kind: "single_choice",
      controlKind: "select",
      options: [
        option("Portugal", false, "o11"),
        option("Canada", false, "o12"),
      ],
    })
    const first = interpretPage({ questions: [asRead], facts, cache })
    expect(
      selectedLabels(asRead, planRead([asRead], facts, first).proposals.q1)
    ).toEqual(["Canada"])

    // The page re-rendered. The same wording and the same labels keep the
    // reading reusable, and every reference has moved up by one, so the one the
    // reading was made with now holds the other country.
    const renumbered = question({
      ref: "q4",
      text: "Country of residence",
      kind: "single_choice",
      controlKind: "select",
      options: [
        option("Portugal", false, "o12"),
        option("Canada", false, "o13"),
      ],
    })
    const second = interpretPage({ questions: [renumbered], facts, cache })
    expect(second.reused).toEqual(["q4"])
    expect(
      selectedLabels(
        renumbered,
        planRead([renumbered], facts, second).proposals.q4
      )
    ).toEqual(["Canada"])
  })

  it("does not send an option the page has since disabled", () => {
    // The same labels keep the reading reusable while the option the fact names
    // is no longer offered. A remembered reference would be sent to the page,
    // where the gate refuses it, and the plan would report the run as refused
    // rather than reporting that the page offers nothing that means it.
    const cache = new InterpretationCache()
    const facts = [
      fact({
        meaning: "country of residence",
        display: "Canada",
        value: { type: "choice", optionIds: ["ca"] },
      }),
    ]
    const offered = question({
      text: "Country of residence",
      kind: "single_choice",
      controlKind: "select",
      options: [option("Portugal"), option("Canada")],
    })
    const first = interpretPage({ questions: [offered], facts, cache })
    expect(planRead([offered], facts, first).plans[0]?.reason).toBe("matched")

    const closed = question({
      ref: "q2",
      text: "Country of residence",
      kind: "single_choice",
      controlKind: "select",
      options: [option("Portugal"), { ...option("Canada"), disabled: true }],
    })
    const second = interpretPage({ questions: [closed], facts, cache })
    expect(second.reused).toEqual(["q2"])
    const planned = planRead([closed], facts, second)
    expect(planned.proposals.q2).toBeUndefined()
    expect(planned.plans[0]?.reason).toBe("no_matching_option")
  })
})

describe("planning an answer", () => {
  const seeds = { q1: "unverified" as const }

  function plan(input: {
    questions: CandidateQuestion[]
    facts: Fact[]
    dispositions?: Record<string, "unsupported" | "preserved" | "unverified">
  }) {
    const interpretations = interpretPage({
      questions: input.questions,
      facts: input.facts,
    })
    return planAnswers({
      questions: input.questions,
      facts: input.facts,
      seeds: input.dispositions ?? seeds,
      interpretations: interpretations.byRef,
    })
  }

  it("plans an answer a fact already contains", () => {
    const target = question({ text: "Email address" })
    const planned = plan({
      questions: [target],
      facts: [
        fact({
          meaning: "email address",
          value: { type: "text", text: "ada@example.com" },
        }),
      ],
    })
    expect(planned.plans[0]?.reason).toBe("matched")
    // Nothing is an answer until the page confirms it.
    expect(planned.plans[0]?.disposition).toBe("unverified")
    expect(planned.proposals.q1?.value).toEqual({
      type: "text",
      text: "ada@example.com",
    })
  })

  it("converts a date to text without losing any part of it", () => {
    const target = question({ text: "Start date" })
    const planned = plan({
      questions: [target],
      facts: [
        fact({
          meaning: "start date",
          value: { type: "date", year: 2024, month: 3, day: 14 },
        }),
      ],
    })
    expect(planned.proposals.q1?.transformation).toBe("format")
    expect(planned.proposals.q1?.value).toEqual({
      type: "text",
      text: "2024-03-14",
    })
  })

  it("refuses a value the gate cannot copy or losslessly convert", () => {
    // Money keeps amount, currency and period apart, and one control cannot
    // hold all three, so this is never proposed rather than proposed and lost.
    const target = question({ text: "Salary expectation" })
    const planned = plan({
      questions: [target],
      facts: [
        fact({
          meaning: "salary expectation",
          value: {
            type: "money",
            amount: 90000,
            currency: "EUR",
            period: "year",
          },
        }),
      ],
    })
    expect(planned.proposals.q1).toBeUndefined()
    expect(planned.plans[0]?.reason).toBe("unsupported_value")
  })

  it("refuses a copy the page's own constraint cannot hold", () => {
    const target = question({
      text: "Employee id",
      constraints: {
        maxLength: 5,
        pattern: null,
        min: null,
        max: null,
        inputMode: null,
      },
    })
    const planned = plan({
      questions: [target],
      facts: [
        fact({
          meaning: "employee id",
          value: { type: "text", text: "1234567890" },
        }),
      ],
    })
    // The gate refuses it, not this module: there is one place that decides.
    expect(planned.plans[0]?.reason).toBe("rejected")
    expect(planned.plans[0]?.rejection).toBe("constraint")
  })

  it("refuses a text value for a question the page typed as a number", () => {
    const target = question({
      text: "Years of experience",
      kind: "number",
      controlKind: "number",
    })
    const planned = plan({
      questions: [target],
      facts: [
        fact({
          meaning: "years of experience",
          value: { type: "text", text: "ten" },
        }),
      ],
    })
    expect(planned.plans[0]?.rejection).toBe("kind_mismatch")
  })

  it("asks for a question no fact matches, and leaves an optional one blank", () => {
    const required = question({ ref: "q1", text: "Why this company?" })
    const optional = question({
      ref: "q2",
      text: "Pronouns",
      requiredness: { state: "optional", evidence: ["native_attribute"] },
    })
    const planned = plan({ questions: [required, optional], facts: [] })
    expect(planned.plans[0]?.reason).toBe("no_matching_fact")
    expect(planned.plans[0]?.disposition).toBe("needs_input")
    expect(planned.plans[1]?.disposition).toBe("optional_blank")
  })

  it("keeps what the reader settled before any answer was attempted", () => {
    const readonly = question({ text: "Application id" })
    const planned = plan({
      questions: [readonly],
      facts: [
        fact({
          meaning: "application id",
          value: { type: "text", text: "42" },
        }),
      ],
      dispositions: { q1: "preserved" },
    })
    expect(planned.plans[0]?.reason).toBe("structural")
    expect(planned.plans[0]?.disposition).toBe("preserved")
    expect(planned.proposals.q1).toBeUndefined()
  })

  it("refuses a choice the page does not offer", () => {
    const target = question({
      text: "Authorized to work in the US?",
      kind: "single_choice",
      controlKind: "radio_group",
      options: [option("Maybe")],
    })
    const planned = plan({
      questions: [target],
      facts: [
        fact({
          meaning: "authorized to work in the us?",
          value: { type: "boolean", state: "yes" },
        }),
      ],
    })
    expect(planned.plans[0]?.reason).toBe("no_matching_option")
  })
})

describe("building the action", () => {
  const precondition = {
    documentGeneration: "gen-1",
    questionRevision: 1,
    sourceBundleId: "bundle-1",
    userEditEpoch: 0,
  }

  it("states what the control holds now, so a moved control is refused", () => {
    const target = question({ text: "Email address" })
    const action = actionFor({
      actionRef: "a1",
      question: target,
      proposal: {
        questionRef: "q1",
        value: { type: "text", text: "ada@example.com" },
        transformation: "copy",
        sources: [{ kind: "user_input" }],
        note: null,
      },
      currentValue: null,
      precondition,
    })
    expect(action).toEqual({
      ref: "a1",
      questionRef: "q1",
      type: "write_text",
      value: "ada@example.com",
      expectedValue: "",
    })
    expect(precondition.documentGeneration).toBe("gen-1")
  })

  it("names the option that is selected now, so a changed choice is refused", () => {
    const target = question({
      text: "Authorized to work in the US?",
      kind: "single_choice",
      controlKind: "radio_group",
      options: [option("Yes"), option("No", true)],
    })
    const action = actionFor({
      actionRef: "a2",
      question: target,
      proposal: {
        questionRef: "q1",
        value: { type: "choice", optionRefs: ["o_yes"] },
        transformation: "option_equivalent",
        sources: [{ kind: "user_input" }],
        note: null,
      },
      currentValue: null,
      precondition,
    })
    expect(action).toEqual({
      ref: "a2",
      questionRef: "q1",
      type: "select_option",
      optionRef: "o_yes",
      expectedOptionRef: "o_no",
    })
  })
})

describe("the review queue", () => {
  function planOf(overrides: Partial<QuestionPlan>): QuestionPlan {
    return {
      questionRef: "q1",
      questionKey: "key",
      disposition: "needs_input",
      reason: "no_matching_fact",
      rejection: null,
      ...overrides,
    }
  }

  it("carries the page's own wording and says whether it blocks", () => {
    const required = question({ ref: "q1", text: "Why this company?" })
    const optional = question({
      ref: "q2",
      text: "Pronouns",
      requiredness: { state: "optional", evidence: ["native_attribute"] },
    })
    const items = reviewQueue({
      questions: [required, optional],
      plans: [
        planOf({ questionRef: "q1" }),
        planOf({ questionRef: "q2", disposition: "optional_blank" }),
      ],
    })
    expect(items.map((item) => item.text)).toEqual([
      "Why this company?",
      "Pronouns",
    ])
    expect(items[0]?.blocking).toBe(true)
    expect(items[1]?.blocking).toBe(false)
  })

  it("keeps a dispatched write that the page did not confirm", () => {
    const target = question({ text: "Email address" })
    const items = reviewQueue({
      questions: [target],
      plans: [planOf({ disposition: "unverified", reason: "matched" })],
      receipts: [
        {
          actionRef: "a1",
          questionRef: "q1",
          state: "unresolved",
          observed: {
            value: null,
            checked: null,
            optionRef: null,
            attachmentLabel: null,
          },
          evidence: ["value_not_settled"],
          at: 1,
        },
      ],
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.reason).toBe("write_unverified")
    expect(items[0]?.detail).toBe("value_not_settled")
  })

  it("drops a question the page confirmed", () => {
    const target = question({ text: "Email address" })
    const items = reviewQueue({
      questions: [target],
      plans: [planOf({ disposition: "unverified", reason: "matched" })],
      receipts: [
        {
          actionRef: "a1",
          questionRef: "q1",
          state: "accepted",
          observed: {
            value: "ada@example.com",
            checked: null,
            optionRef: null,
            attachmentLabel: null,
          },
          evidence: ["value_set"],
          at: 1,
        },
      ],
    })
    expect(items).toEqual([])
  })

  it("lists an answer that passed the gate but never reached the page", () => {
    const target = question({ text: "Email address" })
    const items = reviewQueue({
      questions: [target],
      plans: [planOf({ disposition: "unverified", reason: "matched" })],
      receipts: [],
      notDispatchable: ["q1"],
    })
    expect(items[0]?.reason).toBe("not_dispatchable")
  })
})
