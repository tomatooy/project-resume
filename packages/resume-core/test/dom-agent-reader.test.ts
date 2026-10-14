import { describe, expect, it } from "vitest"
import {
  CandidateQuestionSchema,
  ConstraintsSchema,
  type CandidateQuestion,
  isUnlabelledWording,
  reusableQuestionKey,
  unlabelledWording,
} from "../src/dom-agent/question"
import { NATIVE_CONTROL_KINDS } from "../src/dom-agent/primitives"

/** A question as the enumerator emits one, so the rules can be exercised alone. */
function question(over: Partial<CandidateQuestion> = {}): CandidateQuestion {
  return {
    ref: "q1",
    controlRef: "n1",
    groupRef: null,
    recordRef: null,
    kind: "short_text",
    controlKind: "text",
    text: "First name",
    description: null,
    options: [],
    requiredness: { state: "unknown", evidence: [] },
    constraints: {
      maxLength: null,
      pattern: null,
      min: null,
      max: null,
      inputMode: null,
    },
    scope: [],
    ...over,
  }
}

describe("wording a page never authored", () => {
  it("marks a question instead of dropping it, and says so recognisably", () => {
    const placeholder = unlabelledWording("short_text")
    expect(placeholder).toBe("[unlabelled short_text]")
    expect(isUnlabelledWording(placeholder)).toBe(true)
    // Wording a person could have written is never mistaken for a placeholder.
    expect(isUnlabelledWording("First name")).toBe(false)
    expect(isUnlabelledWording("[unlabelled")).toBe(false)
  })

  it("keeps a question with no authored wording, without giving it an identity", () => {
    const unlabelled = question({ text: unlabelledWording("short_text") })
    // No reusable key, so no saved answer can attach to a field the page never
    // named. Two such fields would otherwise share one identity.
    expect(reusableQuestionKey(unlabelled)).toBeNull()
    // The question itself is still well formed: it is kept and counted.
    expect(CandidateQuestionSchema.safeParse(unlabelled).success).toBe(true)
  })

  it("gives authored wording a stable key and keeps kinds apart", () => {
    const first = reusableQuestionKey(question())
    expect(first).toHaveLength(16)
    // Deterministic: the same page derives the same identity.
    expect(reusableQuestionKey(question())).toBe(first)
    // The kind is part of the identity, so two questions read differently do not
    // collide.
    expect(reusableQuestionKey(question({ kind: "long_text" }))).not.toBe(first)
    // So is explicit page-stated scope: the same wording in two countries is two
    // different questions.
    expect(
      reusableQuestionKey(
        question({ scope: [{ dimension: "country", value: "PT" }] })
      )
    ).not.toBe(first)
  })

  it("changes the key when the option set changes", () => {
    const plain = reusableQuestionKey(question())
    const withOptions = reusableQuestionKey(
      question({
        options: [
          {
            ref: "n2",
            label: "Yes",
            value: null,
            selected: false,
            disabled: false,
          },
          {
            ref: "n3",
            label: "No",
            value: null,
            selected: false,
            disabled: false,
          },
        ],
      })
    )
    expect(withOptions).not.toBe(plain)
  })
})

describe("the native control set", () => {
  it("holds the kinds the browser defines", () => {
    for (const kind of [
      "text",
      "long_text",
      "email",
      "tel",
      "url",
      "number",
      "date",
      "month",
      "select",
      "radio_group",
      "checkbox_group",
      "checkbox",
      "file",
    ])
      expect(NATIVE_CONTROL_KINDS.has(kind)).toBe(true)
  })

  it("excludes the kinds read from a role or not read at all", () => {
    // These are widgets this engine classified by reading a role, so a
    // deterministic decision resting on them would rest on an inference.
    for (const kind of ["combobox", "button_choice", "unknown"])
      expect(NATIVE_CONTROL_KINDS.has(kind)).toBe(false)
  })
})

describe("what a page states about an answer", () => {
  it("keeps constraints as authored, and refuses to invent any", () => {
    const constraints = {
      maxLength: 80,
      pattern: "[a-z]+",
      min: "2020-01-01",
      max: "2026-01-01",
      inputMode: "email",
    }
    expect(ConstraintsSchema.parse(constraints)).toEqual(constraints)
    const empty = ConstraintsSchema.parse({
      maxLength: null,
      pattern: null,
      min: null,
      max: null,
      inputMode: null,
    })
    expect(empty.maxLength).toBeNull()
    // A constraint nobody read is absent, not defaulted to something permissive.
    expect(ConstraintsSchema.safeParse({ maxLength: 80 }).success).toBe(false)
  })
})
