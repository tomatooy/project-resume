import { describe, expect, it } from "vitest"
import type {
  CandidateQuestion,
  Fact,
  FactValue,
  ReasonerAnswer,
  ReasonerOutput,
} from "../src/dom-agent/index"
import { reconcileReasoning, type ReasoningScope } from "../src/dom-agent/index"

/**
 * The gate the reasoning port runs over model output.
 *
 * Every case here is a value a model could plausibly return. What the gate has
 * to guarantee is that only three things may become an answer on their own: an
 * exact copy of an eligible value, an exact lossless conversion, or an option
 * the page itself offers. Everything else stays unresolved and visible, with
 * the reason it was refused.
 */

function question(
  overrides: Partial<CandidateQuestion> = {}
): CandidateQuestion {
  return {
    ref: "q1",
    controlRef: "n12",
    groupRef: null,
    recordRef: null,
    kind: "short_text",
    text: "First name",
    description: null,
    options: [],
    requiredness: { state: "required", evidence: ["native_attribute"] },
    scope: [],
    ...overrides,
  }
}

const YES_NO_OPTIONS = [
  { ref: "n13", label: "Yes", value: "yes", selected: false, disabled: false },
  { ref: "n14", label: "No", value: "no", selected: false, disabled: false },
]

function fact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: "f1",
    meaning: "first name",
    display: "Ada",
    value: { type: "text", text: "Ada" },
    scope: [],
    source: {
      kind: "resume",
      resumeId: "11111111-1111-4111-8111-111111111111",
      versionId: null,
      nodeId: "basics",
      field: "name.first",
    },
    ...overrides,
  }
}

function savedFact(value: FactValue, id = "f2"): Fact {
  return fact({
    id,
    meaning: "saved answer",
    display: "3 months",
    value,
    source: {
      kind: "saved_answer",
      answerId: "22222222-2222-4222-8222-222222222222",
      questionKey: "abcdefghijklmnop",
    },
  })
}

function output(overrides: Partial<ReasonerOutput> = {}): ReasonerOutput {
  return { answers: [], requests: [], ...overrides }
}

function answer(overrides: Partial<ReasonerAnswer> = {}): ReasonerAnswer {
  return {
    questionRef: "q1",
    value: { type: "text", text: "Ada" },
    transformation: "copy",
    factIds: ["f1"],
    note: null,
    ...overrides,
  }
}

function gate(raw: unknown, scope: Partial<ReasoningScope> = {}) {
  return reconcileReasoning(raw, {
    questions: scope.questions ?? [question()],
    facts: scope.facts ?? [fact()],
  })
}

function codes(result: { rejections: { code: string }[] }): string[] {
  return result.rejections.map((rejection) => rejection.code)
}

describe("copy", () => {
  it("takes an exact value and expands the fact into provenance", () => {
    const result = gate(output({ answers: [answer()] }))

    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0]?.value).toEqual({ type: "text", text: "Ada" })
    expect(result.proposals[0]?.transformation).toBe("copy")
    expect(result.proposals[0]?.sources).toEqual([
      {
        kind: "resume",
        resumeId: "11111111-1111-4111-8111-111111111111",
        versionId: null,
        nodeId: "basics",
        field: "name.first",
      },
    ])
    expect(result.unresolved).toEqual([])
    expect(result.rejections).toEqual([])
  })

  it("refuses a value the cited fact does not hold", () => {
    const result = gate(
      output({
        answers: [answer({ value: { type: "text", text: "Grace" } })],
      })
    )

    expect(result.proposals).toEqual([])
    expect(codes(result)).toEqual(["not_same_value"])
    expect(result.unresolved).toEqual(["q1"])
  })

  it("refuses a boolean fact copied straight into an option question", () => {
    const result = gate(
      output({
        answers: [
          answer({
            value: { type: "boolean", value: true, optionRef: "n13" },
          }),
        ],
      }),
      {
        questions: [question({ kind: "yes_no", options: YES_NO_OPTIONS })],
        facts: [fact({ value: { type: "boolean", state: "yes" } })],
      }
    )

    expect(codes(result)).toEqual(["not_same_value"])
  })

  it("refuses a value when no fact is cited at all", () => {
    const result = gate(output({ answers: [answer({ factIds: [] })] }))

    expect(codes(result)).toEqual(["unbound"])
  })

  it("refuses a fact id the bundle does not hold", () => {
    const result = gate(output({ answers: [answer({ factIds: ["nope"] })] }))

    expect(codes(result)).toEqual(["unbound"])
  })
})

describe("format", () => {
  const dated = fact({
    id: "f9",
    meaning: "start date",
    display: "March 2020",
    value: { type: "date", year: 2020, month: 3, day: null },
  })

  function asText(text: string) {
    return answer({
      value: { type: "text", text },
      transformation: "format",
      factIds: ["f9"],
    })
  }

  it("takes the exact text form of a date", () => {
    const result = gate(output({ answers: [asText("2020-03")] }), {
      facts: [dated],
    })

    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0]?.transformation).toBe("format")
  })

  it("refuses a date written any other way", () => {
    for (const text of ["March 2020", "03/2020", "2020-3"]) {
      expect(
        codes(gate(output({ answers: [asText(text)] }), { facts: [dated] }))
      ).toEqual(["not_lossless"])
    }
  })

  it("refuses a padded or exponential number, and takes the plain one", () => {
    const numbered = fact({
      id: "f9",
      value: { type: "number", number: 42000 },
    })
    expect(
      codes(gate(output({ answers: [asText("42000")] }), { facts: [numbered] }))
    ).toEqual([])
    for (const text of ["42,000", "42000.00", "4.2e4"]) {
      expect(
        codes(gate(output({ answers: [asText(text)] }), { facts: [numbered] }))
      ).toEqual(["not_lossless"])
    }
    const huge = fact({ id: "f9", value: { type: "number", number: 1e21 } })
    expect(
      codes(gate(output({ answers: [asText("1e+21")] }), { facts: [huge] }))
    ).toEqual(["not_lossless"])
  })

  it("refuses a conversion of text to text", () => {
    const result = gate(
      output({
        answers: [answer({ transformation: "format", factIds: ["f1"] })],
      })
    )

    expect(codes(result)).toEqual(["not_lossless"])
  })

  it("refuses a conversion the page states a pattern for", () => {
    const result = gate(
      output({
        answers: [
          answer({
            value: { type: "text", text: "2020-03" },
            transformation: "format",
            factIds: ["f9"],
          }),
        ],
      }),
      {
        questions: [
          question({
            constraints: {
              maxLength: null,
              pattern: "^\\d{2}/\\d{4}$",
              min: null,
              max: null,
              inputMode: null,
            },
          }),
        ],
        facts: [dated],
      }
    )

    expect(codes(result)).toEqual(["not_lossless"])
  })
})

describe("option equivalence", () => {
  const yesNo = question({ kind: "yes_no", options: YES_NO_OPTIONS })
  const booleanFact = fact({ value: { type: "boolean", state: "yes" } })

  it("takes an option the page offers, by reference", () => {
    const result = gate(
      output({
        answers: [
          answer({
            value: { type: "boolean", value: true, optionRef: "n13" },
            transformation: "option_equivalent",
          }),
        ],
      }),
      { questions: [yesNo], facts: [booleanFact] }
    )

    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0]?.transformation).toBe("option_equivalent")
  })

  it("refuses a reference the question never offered", () => {
    const result = gate(
      output({
        answers: [
          answer({
            value: { type: "boolean", value: true, optionRef: "n99" },
            transformation: "option_equivalent",
          }),
        ],
      }),
      { questions: [yesNo], facts: [booleanFact] }
    )

    expect(codes(result)).toEqual(["option_not_observed"])
  })

  it("refuses a disabled option", () => {
    const disabled = question({
      kind: "yes_no",
      options: [
        {
          ref: "n20",
          label: "Yes",
          value: "yes",
          selected: false,
          disabled: true,
        },
      ],
    })
    const result = gate(
      output({
        answers: [
          answer({
            value: { type: "boolean", value: true, optionRef: "n20" },
            transformation: "option_equivalent",
          }),
        ],
      }),
      { questions: [disabled], facts: [booleanFact] }
    )

    expect(codes(result)).toEqual(["option_not_observed"])
  })

  it("refuses two options for a single-choice question", () => {
    const single = question({
      kind: "single_choice",
      options: YES_NO_OPTIONS,
    })
    const result = gate(
      output({
        answers: [
          answer({
            value: { type: "choice", optionRefs: ["n13", "n14"] },
            transformation: "option_equivalent",
          }),
        ],
      }),
      {
        questions: [single],
        facts: [fact({ value: { type: "choice", optionIds: ["yes"] } })],
      }
    )

    expect(codes(result)).toEqual(["option_count"])
  })

  it("refuses an option claimed from a fact that is not a choice", () => {
    const result = gate(
      output({
        answers: [
          answer({
            value: { type: "boolean", value: true, optionRef: "n13" },
            transformation: "option_equivalent",
            factIds: ["f1"],
          }),
        ],
      }),
      { questions: [yesNo], facts: [fact()] }
    )

    expect(codes(result)).toEqual(["unbound"])
  })
})

describe("user confirmation", () => {
  it("refuses a resume fact labelled as the user's own confirmation", () => {
    const result = gate(
      output({ answers: [answer({ transformation: "user_confirmed" })] })
    )

    expect(codes(result)).toEqual(["not_user_confirmed"])
  })

  it("takes a stored answer the user wrote, and only at its own value", () => {
    const stored = savedFact({ type: "text", text: "3 months" })
    const held = gate(
      output({
        answers: [
          answer({
            value: { type: "text", text: "3 months" },
            transformation: "user_confirmed",
            factIds: ["f2"],
          }),
        ],
      }),
      { facts: [stored] }
    )
    expect(held.proposals).toHaveLength(1)

    const changed = gate(
      output({
        answers: [
          answer({
            value: { type: "text", text: "6 months" },
            transformation: "user_confirmed",
            factIds: ["f2"],
          }),
        ],
      }),
      { facts: [stored] }
    )
    expect(codes(changed)).toEqual(["not_same_value"])
  })

  it("takes a confirmed option from a stored text answer", () => {
    const stored = savedFact({ type: "text", text: "Yes" }, "f3")
    const result = gate(
      output({
        answers: [
          answer({
            value: { type: "boolean", value: true, optionRef: "n13" },
            transformation: "user_confirmed",
            factIds: ["f3"],
          }),
        ],
      }),
      {
        questions: [question({ kind: "yes_no", options: YES_NO_OPTIONS })],
        facts: [stored],
      }
    )

    expect(result.proposals).toHaveLength(1)
  })
})

describe("what a question kind accepts", () => {
  it("never reads a number out of a text fact", () => {
    const textFact = fact({ value: { type: "text", text: "42000" } })
    const scope = {
      questions: [question({ kind: "number" })],
      facts: [textFact],
    }
    // Copy claims the fact's own value, and the fact's value is the string.
    expect(
      codes(
        gate(
          output({
            answers: [answer({ value: { type: "number", number: 42000 } })],
          }),
          scope
        )
      )
    ).toEqual(["not_same_value"])
    // A conversion of text is not one of the lossless ones.
    expect(
      codes(
        gate(
          output({
            answers: [
              answer({
                value: { type: "number", number: 42000 },
                transformation: "format",
              }),
            ],
          }),
          scope
        )
      )
    ).toEqual(["not_lossless"])
  })

  it("refuses a text value for a number question", () => {
    const result = gate(output({ answers: [answer()] }), {
      questions: [question({ kind: "number" })],
    })
    expect(codes(result)).toEqual(["kind_mismatch"])
  })

  it("refuses a question whose kind the driver never established", () => {
    const result = gate(output({ answers: [answer()] }), {
      questions: [question({ kind: "unknown" })],
    })

    expect(codes(result)).toEqual(["kind_mismatch"])
  })

  it("refuses a day for a month control and takes a month without one", () => {
    const month = question({ kind: "month" })
    const withDay = fact({
      id: "f9",
      value: { type: "date", year: 2020, month: 3, day: 15 },
    })
    expect(
      codes(
        gate(
          output({
            answers: [
              answer({
                value: { type: "date", year: 2020, month: 3, day: 15 },
                factIds: ["f9"],
              }),
            ],
          }),
          { questions: [month], facts: [withDay] }
        )
      )
    ).toEqual(["kind_mismatch"])

    const withoutDay = fact({
      id: "f9",
      value: { type: "date", year: 2020, month: 3, day: null },
    })
    expect(
      codes(
        gate(
          output({
            answers: [
              answer({
                value: { type: "date", year: 2020, month: 3, day: null },
                factIds: ["f9"],
              }),
            ],
          }),
          { questions: [month], facts: [withoutDay] }
        )
      )
    ).toEqual([])
  })

  it("refuses an attachment, which the bundle renders rather than proposes", () => {
    const result = gate(
      output({ answers: [answer({ value: { type: "file" } })] }),
      { questions: [question({ kind: "file" })] }
    )

    expect(codes(result)).toEqual(["kind_mismatch"])
  })

  it("refuses money, because nothing here carries a currency and a period", () => {
    const money = fact({
      value: {
        type: "money",
        amount: 100000,
        currency: "USD",
        period: "year",
      },
    })
    const scope = {
      questions: [question({ kind: "money" })],
      facts: [money],
    }
    expect(
      codes(
        gate(
          output({
            answers: [answer({ value: { type: "number", number: 100000 } })],
          }),
          scope
        )
      )
    ).toEqual(["not_same_value"])
    expect(
      codes(
        gate(
          output({
            answers: [
              answer({
                value: { type: "text", text: "100000" },
                transformation: "format",
              }),
            ],
          }),
          scope
        )
      )
    ).toEqual(["not_lossless"])
  })

  it("refuses text longer than the page's own limit", () => {
    const result = gate(output({ answers: [answer()] }), {
      questions: [
        question({
          constraints: {
            maxLength: 2,
            pattern: null,
            min: null,
            max: null,
            inputMode: null,
          },
        }),
      ],
    })

    expect(codes(result)).toEqual(["constraint"])
  })
})

describe("the batch is closed", () => {
  it("refuses an answer to a question that was not in the request", () => {
    const result = gate(output({ answers: [answer({ questionRef: "q7" })] }))

    expect(result.proposals).toEqual([])
    expect(codes(result)).toEqual(["unknown_question"])
    expect(result.unresolved).toEqual(["q1"])
  })

  it("takes the first answer for a question and reports the rest", () => {
    const result = gate(
      output({ answers: [answer(), answer({ note: "again" })] })
    )

    expect(result.proposals).toHaveLength(1)
    expect(codes(result)).toEqual(["duplicate_answer"])
  })

  it("keeps every question the model did not mention", () => {
    const result = gate(output({ answers: [answer()] }), {
      questions: [question({ ref: "q1" }), question({ ref: "q2" })],
    })

    expect(result.proposals).toHaveLength(1)
    expect(result.unresolved).toEqual(["q2"])
  })
})

describe("requests for information", () => {
  it("carries what is missing and no value", () => {
    const result = gate(
      output({
        requests: [{ questionRef: "q1", missing: "notice period" }],
      })
    )

    expect(result.requests).toEqual([
      { questionRef: "q1", missing: "notice period" },
    ])
    expect(result.unresolved).toEqual([])
    expect(result.proposals).toEqual([])
  })

  it("drops a request for a question that was answered", () => {
    const result = gate(
      output({
        answers: [answer()],
        requests: [{ questionRef: "q1", missing: "notice period" }],
      })
    )

    expect(result.requests).toEqual([])
    expect(result.proposals).toHaveLength(1)
  })

  it("asks once, however many times the model repeats itself", () => {
    const result = gate(
      output({
        requests: [
          { questionRef: "q1", missing: "notice period" },
          { questionRef: "q1", missing: "notice period, again" },
        ],
      })
    )

    expect(result.requests).toHaveLength(1)
  })

  it("refuses a request for a question that was not in the request", () => {
    const result = gate(
      output({ requests: [{ questionRef: "q7", missing: "notice period" }] })
    )

    expect(codes(result)).toEqual(["unknown_question"])
    expect(result.unresolved).toEqual(["q1"])
  })
})

describe("output that is not the required shape", () => {
  it("refuses prose, and leaves every question visible", () => {
    for (const raw of [
      "I could not answer these questions.",
      { answers: "yes" },
      { answers: [{ questionRef: "q1" }] },
      { answers: [{ ...answer(), factIds: Array(9).fill("f1") }] },
    ]) {
      const result = gate(raw)
      expect(codes(result)).toEqual(["unparsed"])
      expect(result.proposals).toEqual([])
      expect(result.unresolved).toEqual(["q1"])
    }
  })

  it("reports the refusal without a question when the shape is wrong", () => {
    const result = gate({ answers: [], requests: [], extra: true })
    expect(result.rejections[0]?.questionRef).toBeNull()
  })
})

describe("the text form of a value", () => {
  it("pads a date so the text is exact", () => {
    const result = gate(
      output({
        answers: [
          answer({
            value: { type: "text", text: "0800-03" },
            transformation: "format",
            factIds: ["f9"],
          }),
        ],
      }),
      {
        facts: [
          fact({
            id: "f9",
            value: { type: "date", year: 800, month: 3, day: null },
          }),
        ],
      }
    )

    expect(result.proposals).toHaveLength(1)
  })
})
