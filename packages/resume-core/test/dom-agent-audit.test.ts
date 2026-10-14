import { describe, expect, it } from "vitest"
import {
  type CandidateQuestion,
  type Observation,
  type ObservationNode,
  type ObservedControl,
  type QuestionDisposition,
  type Receipt,
  PageAuditSchema,
  buildPageAudit,
  issueRefs,
  readiness,
} from "../src/dom-agent"

/**
 * The page audit: what a whole page's verdict is built from, and the honesty
 * rules it is under. Every case here is hand-written input with no browser and
 * no model, so the rules are checked rather than a page double's behaviour.
 */

function control(overrides: Partial<ObservedControl> = {}): ObservedControl {
  return {
    kind: "text",
    value: null,
    checked: null,
    multiple: false,
    readonly: false,
    disabled: false,
    options: [],
    accepts: null,
    ...overrides,
  }
}

function node(
  ref: string,
  state: ObservedControl | null,
  overrides: Partial<ObservationNode> = {}
): ObservationNode {
  return {
    ref,
    contextId: "root",
    parentRef: null,
    kind: "element",
    tag: "input",
    role: "textbox",
    name: null,
    text: null,
    control: state,
    ...overrides,
  }
}

function question(
  overrides: Partial<CandidateQuestion> = {}
): CandidateQuestion {
  return {
    ref: "q1",
    controlRef: "n1",
    groupRef: null,
    recordRef: null,
    kind: "short_text",
    text: "Email address",
    description: null,
    options: [],
    requiredness: { state: "required", evidence: ["native_attribute"] },
    controlKind: "text",
    scope: [],
    ...overrides,
  }
}

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
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
    at: 2_000,
    ...overrides,
  }
}

function page(input: {
  nodes?: ObservationNode[]
  coverage?: Observation["coverage"]
}): Pick<Observation, "id" | "coverage" | "nodes"> {
  return {
    id: "obs1",
    nodes: input.nodes ?? [],
    coverage: input.coverage ?? { complete: true, gaps: [] },
  }
}

function build(input: {
  questions: CandidateQuestion[]
  dispositions: Record<string, QuestionDisposition | undefined>
  nodes?: ObservationNode[]
  coverage?: Observation["coverage"]
  receipts?: Receipt[]
}) {
  return buildPageAudit({
    id: "audit1",
    observation: page({ nodes: input.nodes, coverage: input.coverage }),
    observedAt: 1_000,
    questions: input.questions,
    dispositions: input.dispositions,
    receipts: input.receipts ?? [],
  })
}

describe("the page audit", () => {
  it("places every question in exactly one outcome", () => {
    const questions = [
      question({ ref: "q1", controlRef: "n1" }),
      question({
        ref: "q2",
        controlRef: "n2",
        requiredness: { state: "optional", evidence: ["visible_marker"] },
      }),
      question({ ref: "q3", controlRef: "n3", kind: "unknown" }),
      question({ ref: "q4", controlRef: "n4" }),
      question({
        ref: "q5",
        controlRef: "n5",
        requiredness: { state: "optional", evidence: ["visible_marker"] },
      }),
    ]
    const audit = build({
      questions,
      nodes: [
        node("n1", control()),
        node("n2", control({ value: "Lisbon", readonly: true })),
        node("n3", control({ kind: "unknown" })),
        node("n4", control()),
        node("n5", control()),
      ],
      receipts: [receipt({ questionRef: "q1" })],
      dispositions: {
        q1: "answered",
        q2: "preserved",
        q3: "unsupported",
        q4: "needs_input",
        q5: "optional_blank",
      },
    })

    expect(audit.verified).toEqual(["q1"])
    expect(audit.preserved).toEqual(["q2"])
    expect(audit.issues).toEqual([
      {
        kind: "unsupported_control",
        questionRef: "q3",
        detail: expect.any(String),
      },
      { kind: "missing_required", questionRef: "q4" },
    ])
    // The optional blank is settled and is in none of the three: a filled count
    // is not what it is for.
    expect(issueRefs(audit.issues)).toEqual(["q3", "q4"])
  })

  it("counts a write the page accepted as verified and one it never confirmed as unverified", () => {
    const questions = [
      question({ ref: "q1", controlRef: "n1" }),
      question({ ref: "q2", controlRef: "n2" }),
    ]
    const audit = build({
      questions,
      nodes: [node("n1", control()), node("n2", control())],
      receipts: [
        receipt({ questionRef: "q1" }),
        receipt({
          actionRef: "a2",
          questionRef: "q2",
          state: "unresolved",
          observed: {
            value: null,
            checked: null,
            optionRef: null,
            attachmentLabel: null,
          },
          evidence: ["value_not_settled"],
        }),
      ],
      dispositions: { q1: "answered", q2: "unverified" },
    })

    expect(audit.verified).toEqual(["q1"])
    expect(audit.issues).toEqual([
      {
        kind: "unverified",
        questionRef: "q2",
        detail: expect.stringContaining("value_not_settled"),
      },
    ])
  })

  it("reports a refusal as a failed control, not as a write nothing confirmed", () => {
    const audit = build({
      questions: [question({ ref: "q1", controlRef: "n1" })],
      nodes: [node("n1", control())],
      receipts: [receipt({ state: "failed", evidence: ["value_reverted"] })],
      dispositions: { q1: "unverified" },
    })

    expect(audit.issues).toEqual([
      {
        kind: "failed_control",
        questionRef: "q1",
        detail: expect.stringContaining("value_reverted"),
      },
    ])
  })

  it("only counts a preserved value whose committed state the page states", () => {
    const questions = [
      question({ ref: "q1", controlRef: "n1" }),
      question({ ref: "q2", controlRef: "n2" }),
    ]
    const audit = build({
      questions,
      nodes: [
        node("n1", control({ value: "Rua Augusta 12", readonly: true })),
        // Readonly, and the read came back with no value, no selection and no
        // checked state: the page has told the audit nothing to count, so the
        // field is not satisfied by it.
        node("n2", control({ readonly: true, value: "" })),
      ],
      dispositions: { q1: "preserved", q2: "preserved" },
    })

    expect(audit.preserved).toEqual(["q1"])
    expect(audit.issues).toEqual([
      {
        kind: "unverified",
        questionRef: "q2",
        detail: expect.any(String),
      },
    ])
  })

  it("counts a selection the page states as a committed value", () => {
    const audit = build({
      questions: [
        question({
          ref: "q1",
          controlRef: "n1",
          kind: "single_choice",
          controlKind: "select",
          options: [
            {
              ref: "n9",
              label: "Lisbon",
              value: "lisbon",
              selected: true,
              disabled: false,
            },
          ],
        }),
      ],
      nodes: [node("n1", control({ kind: "select", readonly: true }))],
      dispositions: { q1: "preserved" },
    })

    expect(audit.preserved).toEqual(["q1"])
    expect(audit.issues).toEqual([])
  })

  it("carries no page value that could become a reusable fact", () => {
    const secret = "Rua Augusta 12, 3rd floor"
    const audit = build({
      questions: [question({ ref: "q1", controlRef: "n1" })],
      nodes: [node("n1", control({ value: secret, readonly: true }))],
      dispositions: { q1: "preserved" },
    })

    // A preserved ref is named and nothing else: the audit has no field a value
    // could ride in, so a caller cannot turn one into an answer.
    expect(audit.preserved).toEqual(["q1"])
    expect(JSON.stringify(audit)).not.toContain(secret)
  })

  it("says why a control cannot be written into", () => {
    const cases: [
      ObservedControl | null,
      Partial<CandidateQuestion>,
      RegExp,
    ][] = [
      [null, {}, /No control/],
      [control({ disabled: true }), {}, /disabled/],
      [control({ multiple: true }), {}, /more than one selection/],
      [control({ kind: "unknown" }), { kind: "unknown" }, /not recognised/],
    ]
    for (const [state, overrides, expected] of cases) {
      const audit = build({
        questions: [question({ ref: "q1", controlRef: "n1", ...overrides })],
        nodes: [node("n1", state)],
        dispositions: { q1: "unsupported" },
      })
      const issue = audit.issues[0]
      expect(issue?.kind).toBe("unsupported_control")
      expect(issue?.kind === "unsupported_control" ? issue.detail : "").toMatch(
        expected
      )
    }
  })

  it("reports a required question the run has nothing for", () => {
    const audit = build({
      questions: [question({ ref: "q1", controlRef: "n1" })],
      nodes: [node("n1", control())],
      dispositions: { q1: "needs_input" },
    })

    expect(audit.issues).toEqual([
      { kind: "missing_required", questionRef: "q1" },
    ])
    expect(
      readiness({ audit, questions: [question({ controlRef: "n1" })] })
    ).toMatchObject({ state: "incomplete" })
  })

  it("leaves an optional blank settled and an unknown requiredness unresolved", () => {
    const settled = build({
      questions: [
        question({
          ref: "q1",
          controlRef: "n1",
          requiredness: { state: "optional", evidence: ["visible_marker"] },
        }),
      ],
      nodes: [node("n1", control())],
      dispositions: { q1: "optional_blank" },
    })
    expect(settled.issues).toEqual([])

    // The page never said this one was optional, so a blank is not an answer.
    const unknown = build({
      questions: [
        question({
          ref: "q1",
          controlRef: "n1",
          requiredness: { state: "unknown", evidence: [] },
        }),
      ],
      nodes: [node("n1", control())],
      dispositions: { q1: "optional_blank" },
    })
    expect(unknown.issues).toEqual([
      { kind: "missing_required", questionRef: "q1" },
    ])
  })

  it("turns every coverage gap into an unobserved region", () => {
    const audit = build({
      questions: [question({ ref: "q1", controlRef: "n1" })],
      nodes: [node("n1", control())],
      receipts: [receipt({ questionRef: "q1" })],
      dispositions: { q1: "answered" },
      coverage: {
        complete: false,
        gaps: [
          {
            scope: "frame 2",
            reason: "cross_origin",
            detail: "the document could not be read from this context",
          },
        ],
      },
    })

    expect(audit.issues).toEqual([
      {
        kind: "unobserved_region",
        scope: "frame 2",
        detail: "the document could not be read from this context",
      },
    ])
    // Every question is answered, and the page is still not ready: a region
    // nobody read is not a region that was fine.
    expect(
      readiness({ audit, questions: [question({ controlRef: "n1" })] })
    ).toMatchObject({ state: "incomplete" })
  })

  it("names what it could not check rather than reporting nothing wrong", () => {
    const audit = build({
      questions: [question({ ref: "q1", controlRef: "n1" })],
      nodes: [node("n1", control())],
      receipts: [receipt({ questionRef: "q1" })],
      dispositions: { q1: "answered" },
    })

    // Nothing is wrong with this page and the audit still says what it did not
    // look at, so an empty issue list cannot be read as "everything was
    // checked".
    expect(audit.issues).toEqual([])
    expect(audit.unchecked.map((entry) => entry.dimension)).toEqual([
      "validation_errors",
      "source_conflicts",
      "cross_field_consistency",
    ])
    for (const entry of audit.unchecked) expect(entry.reason).not.toBe("")
    // A limit of the engine is not a gap in the page, so it does not block.
    expect(
      readiness({ audit, questions: [question({ controlRef: "n1" })] })
    ).toEqual({ state: "ready" })
  })

  it("judges a question by its latest receipt", () => {
    const questions = [question({ ref: "q1", controlRef: "n1" })]
    const nodes = [node("n1", control())]
    const audit = build({
      questions,
      nodes,
      // The first pass failed and a later one landed. The question is done.
      receipts: [
        receipt({
          actionRef: "a1",
          state: "failed",
          evidence: ["value_reverted"],
        }),
        receipt({ actionRef: "a2" }),
      ],
      dispositions: { q1: "answered" },
    })

    expect(audit.verified).toEqual(["q1"])
    expect(audit.issues).toEqual([])
  })

  it("keeps a disposition this observation does not hold, so it can be called stale", () => {
    const audit = build({
      questions: [question({ ref: "q1", controlRef: "n1" })],
      nodes: [node("n1", control())],
      receipts: [receipt({ questionRef: "q1" })],
      dispositions: { q1: "answered", q404: "answered" },
    })

    expect(audit.dispositions.q404).toBe("answered")
    const verdict = readiness({
      audit,
      questions: [question({ controlRef: "n1" })],
    })
    expect(verdict.state).toBe("incomplete")
    if (verdict.state === "incomplete")
      expect(verdict.reasons.join(" ")).toContain("q404")
  })

  it("never carries a claim about what the site will accept", () => {
    const audit = build({
      questions: [question({ ref: "q1", controlRef: "n1" })],
      nodes: [node("n1", control())],
      receipts: [receipt({ questionRef: "q1" })],
      dispositions: { q1: "answered" },
    })
    const verdict = readiness({
      audit,
      questions: [question({ controlRef: "n1" })],
    })

    // `ready` is the whole verdict: there is no message for a caller to show
    // that could claim more than the audit checked.
    expect(verdict).toEqual({ state: "ready" })
    expect(Object.keys(verdict)).toEqual(["state"])
    expect(JSON.stringify(verdict)).not.toMatch(/accept|submit|valid/i)
  })

  it("is ready only when nothing is missing and nothing was left unread", () => {
    const questions = [question({ ref: "q1", controlRef: "n1" })]
    const nodes = [node("n1", control())]
    const dispositions = { q1: "answered" as const }
    const receipts = [receipt({ questionRef: "q1" })]

    expect(
      readiness({
        audit: build({ questions, nodes, dispositions, receipts }),
        questions,
      })
    ).toEqual({ state: "ready" })

    const gap = build({
      questions,
      nodes,
      dispositions,
      receipts,
      coverage: {
        complete: false,
        gaps: [{ scope: "page", reason: "budget", detail: "trimmed" }],
      },
    })
    expect(readiness({ audit: gap, questions })).toMatchObject({
      state: "incomplete",
    })

    const failed = build({
      questions,
      nodes,
      dispositions: { q1: "unverified" },
      receipts: [receipt({ state: "failed", evidence: ["value_reverted"] })],
    })
    expect(readiness({ audit: failed, questions })).toMatchObject({
      state: "incomplete",
    })
  })

  it("keeps a question it cannot account for out of every outcome", () => {
    const audit = build({
      questions: [question({ ref: "q1", controlRef: "n1" })],
      nodes: [node("n1", control())],
      dispositions: {},
    })

    // The verdict names it; the audit does not invent an outcome for it, so the
    // rule that found it stays visible.
    expect(audit.verified).toEqual([])
    expect(audit.preserved).toEqual([])
    expect(audit.issues).toEqual([])
    const verdict = readiness({
      audit,
      questions: [question({ controlRef: "n1" })],
    })
    expect(verdict.state).toBe("incomplete")
    if (verdict.state === "incomplete")
      expect(verdict.reasons.join(" ")).toContain("q1")
  })

  it("produces a report that parses as the audit it claims to be", () => {
    const audit = build({
      questions: [question({ ref: "q1", controlRef: "n1" })],
      nodes: [node("n1", control())],
      receipts: [receipt({ questionRef: "q1" })],
      dispositions: { q1: "answered" },
    })
    expect(() => PageAuditSchema.parse(audit)).not.toThrow()
    expect(audit.observationId).toBe("obs1")
    expect(audit.observedAt).toBe(1_000)
  })
})
