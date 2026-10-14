import { describe, expect, it } from "vitest"
import {
  UNKNOWN_APPLICATION,
  accountStatePrefix,
  applicationIdentity,
  attachmentIsAuthorized,
  canTransition,
  canonicalQuestion,
  citedSourcesExist,
  coverageSummary,
  isTerminal,
  isTemporaryStateKey,
  normalizeQuestionText,
  observationCoverage,
  ObservationSchema,
  pdfIdentity,
  type CandidateQuestion,
  questionIsSettled,
  questionKey,
  readiness,
  sameApplication,
  sourceBundleId,
  SourceBundleSchema,
  temporaryStateKey,
  unaccountedQuestions,
  verifiedProgress,
  type Fact,
  type PageAudit,
  type Receipt,
} from "../src/dom-agent/index"

function question(
  overrides: Partial<CandidateQuestion> = {}
): CandidateQuestion {
  return {
    ref: "q1",
    controlRef: "n12",
    groupRef: null,
    recordRef: null,
    kind: "yes_no",
    text: "Do you require sponsorship?",
    description: null,
    options: [
      {
        ref: "n13",
        label: "Yes",
        value: "yes",
        selected: false,
        disabled: false,
      },
      {
        ref: "n14",
        label: "No",
        value: "no",
        selected: false,
        disabled: false,
      },
    ],
    requiredness: { state: "required", evidence: ["aria_attribute"] },
    scope: [{ dimension: "country", value: "US" }],
    ...overrides,
  }
}

function audit(overrides: Partial<PageAudit> = {}): PageAudit {
  return {
    id: "audit1",
    observationId: "obs1",
    observedAt: 1_000,
    coverage: { complete: true, gaps: [] },
    dispositions: {},
    issues: [],
    verified: [],
    preserved: [],
    ...overrides,
  }
}

function fact(source = "profile:workAuthorization:sponsorship"): Fact {
  const [, section, field] = source.split(":")
  return {
    id: "f1",
    meaning: "requires sponsorship",
    display: "Yes",
    value: { type: "boolean", state: "yes" },
    scope: [],
    source: {
      kind: "profile",
      section: section as string,
      field: field as string,
    },
  }
}

describe("question identity", () => {
  const base = {
    text: "Do you require sponsorship?",
    kind: "yes_no" as const,
    scope: [{ dimension: "country" as const, value: "US" }],
    options: [{ label: "Yes" }, { label: "No" }],
  }

  it("is stable for the same question", () => {
    expect(questionKey(base)).toBe(questionKey({ ...base }))
  })

  it("ignores the decoration a page adds to the same wording", () => {
    for (const text of [
      "Do you require sponsorship?",
      "  do you require sponsorship?  ",
      "Do you require sponsorship? *",
      "Do you require sponsorship?\u00a0",
    ])
      expect(questionKey({ ...base, text })).toBe(questionKey(base))
  })

  it("separates questions that only differ in scope", () => {
    expect(
      questionKey({ ...base, scope: [{ dimension: "country", value: "CA" }] })
    ).not.toBe(questionKey(base))
    expect(questionKey({ ...base, scope: [] })).not.toBe(questionKey(base))
  })

  it("separates questions that differ in kind", () => {
    expect(questionKey({ ...base, kind: "short_text" })).not.toBe(
      questionKey(base)
    )
  })

  it("does not depend on the order options appear in", () => {
    expect(
      questionKey({ ...base, options: [{ label: "No" }, { label: "Yes" }] })
    ).toBe(questionKey(base))
    expect(
      questionKey({ ...base, options: [{ label: "Yes" }, { label: "Maybe" }] })
    ).not.toBe(questionKey(base))
  })

  it("derives identity from nothing a browser session provides", () => {
    const browserBound = question({ text: base.text })
    const other = question({
      ref: "q99",
      controlRef: "n900",
      options: [
        {
          ref: "n901",
          label: "Yes",
          value: "yes",
          selected: false,
          disabled: false,
        },
        {
          ref: "n902",
          label: "No",
          value: "no",
          selected: false,
          disabled: false,
        },
      ],
    })
    expect(questionKey(browserBound)).toBe(questionKey(other))
  })

  it("exposes the canonical form so a difference can be read", () => {
    const canonical = canonicalQuestion(base)
    expect(canonical).toContain("v1")
    expect(canonical).toContain("text=do you require sponsorship?")
    expect(canonical).toContain("scope=country=us")
    expect(canonical).toContain("options=no|yes")
    expect(canonicalQuestion({ ...base, kind: "short_text" })).not.toBe(
      canonical
    )
  })

  it("normalizes wording the way a person reads it", () => {
    expect(
      normalizeQuestionText("  Do\u00a0you REQUIRE   sponsorship? * ")
    ).toBe("do you require sponsorship?")
  })
})

describe("accounting", () => {
  it("reports every question with no disposition, never a count alone", () => {
    const questions = [question({ ref: "q1" }), question({ ref: "q2" })]
    expect(unaccountedQuestions(questions, {})).toEqual(["q1", "q2"])
    expect(unaccountedQuestions(questions, { q1: "answered" })).toEqual(["q2"])
    expect(
      unaccountedQuestions(questions, { q1: "answered", q2: "optional_blank" })
    ).toEqual([])
  })

  it("only lets an optional question stay blank", () => {
    const optional = question({
      requiredness: { state: "optional", evidence: ["visible_marker"] },
    })
    const unknown = question({
      requiredness: { state: "unknown", evidence: [] },
    })
    for (const settled of ["answered", "preserved"] as const) {
      expect(questionIsSettled(question(), settled)).toBe(true)
      expect(questionIsSettled(optional, settled)).toBe(true)
      expect(questionIsSettled(unknown, settled)).toBe(true)
    }
    expect(questionIsSettled(optional, "optional_blank")).toBe(true)
    expect(questionIsSettled(question(), "optional_blank")).toBe(false)
    expect(questionIsSettled(unknown, "optional_blank")).toBe(false)
  })
})

describe("readiness", () => {
  it("is ready when every question is settled and nothing was missed", () => {
    const questions = [question({ ref: "q1" }), question({ ref: "q2" })]
    expect(
      readiness({
        questions,
        audit: audit({
          dispositions: { q1: "answered", q2: "preserved" },
          verified: ["q1"],
          preserved: ["q2"],
        }),
      })
    ).toEqual({ state: "ready" })
  })

  it("stays ready when an optional question is deliberately blank", () => {
    const optional = question({
      requiredness: { state: "optional", evidence: ["visible_marker"] },
    })
    expect(
      readiness({
        questions: [optional],
        audit: audit({ dispositions: { q1: "optional_blank" } }),
      })
    ).toEqual({ state: "ready" })
  })

  it("is incomplete for a question nobody accounted for", () => {
    const verdict = readiness({
      questions: [question({ ref: "q1" }), question({ ref: "q2" })],
      audit: audit({ dispositions: { q1: "answered" } }),
    })
    expect(verdict.state).toBe("incomplete")
    if (verdict.state === "incomplete")
      expect(verdict.reasons.join(" ")).toContain("q2")
  })

  it("is incomplete for each way a page can be unresolved", () => {
    const cases: Partial<PageAudit>[] = [
      { dispositions: { q1: "needs_input" } },
      { dispositions: { q1: "conflict" } },
      { dispositions: { q1: "unsupported" } },
      { dispositions: { q1: "unverified" } },
      {
        coverage: {
          complete: false,
          gaps: [
            { scope: "frame 2", reason: "cross_origin", detail: "no session" },
          ],
        },
      },
      {
        issues: [
          {
            kind: "validation_error",
            questionRef: "q1",
            message: "Enter a valid date",
          },
        ],
      },
    ]
    for (const override of cases) {
      const dispositions = override.dispositions ?? { q1: "answered" }
      const verdict = readiness({
        questions: [question({ ref: "q1" })],
        audit: audit({ ...override, dispositions }),
      })
      expect(verdict.state).toBe("incomplete")
    }
  })

  it("treats an unknown requiredness left blank as unresolved", () => {
    const verdict = readiness({
      questions: [
        question({ requiredness: { state: "unknown", evidence: [] } }),
      ],
      audit: audit({ dispositions: { q1: "optional_blank" } }),
    })
    expect(verdict.state).toBe("incomplete")
  })

  it("refuses a disposition that belongs to another observation", () => {
    const verdict = readiness({
      questions: [question({ ref: "q1" })],
      audit: audit({
        dispositions: { q1: "answered", q404: "answered" },
      }),
    })
    expect(verdict.state).toBe("incomplete")
    if (verdict.state === "incomplete")
      expect(verdict.reasons.join(" ")).toContain("q404")
  })

  it("counts progress without letting it decide readiness", () => {
    const receipts: Receipt[] = [
      {
        actionRef: "a1",
        questionRef: "q1",
        state: "accepted",
        observed: {
          value: "Yes",
          checked: null,
          optionRef: null,
          attachmentLabel: null,
        },
        evidence: [],
        at: 1,
      },
      {
        actionRef: "a2",
        questionRef: "q2",
        state: "dispatched",
        observed: {
          value: null,
          checked: null,
          optionRef: null,
          attachmentLabel: null,
        },
        evidence: [],
        at: 2,
      },
    ]
    expect(verifiedProgress(receipts)).toEqual({
      accepted: 1,
      unresolved: 1,
      failed: 0,
    })
  })
})

describe("run states", () => {
  it("allows the transitions a run actually makes", () => {
    expect(canTransition("observing", "running")).toBe(true)
    expect(canTransition("running", "auditing")).toBe(true)
    expect(canTransition("auditing", "ready")).toBe(true)
    expect(canTransition("auditing", "incomplete")).toBe(true)
    expect(canTransition("incomplete", "running")).toBe(true)
    expect(canTransition("needs_input", "paused")).toBe(true)
    expect(canTransition("paused", "observing")).toBe(true)
  })

  it("never resumes a plan from a pause", () => {
    expect(canTransition("paused", "running")).toBe(false)
    expect(canTransition("paused", "auditing")).toBe(false)
  })

  it("treats cancellation as final and ready as re-auditable", () => {
    expect(isTerminal("cancelled")).toBe(true)
    expect(canTransition("cancelled", "running")).toBe(false)
    expect(canTransition("ready", "auditing")).toBe(true)
  })
})

describe("application identity", () => {
  it("retains an explicit job identity across manually selected steps", () => {
    expect(
      applicationIdentity("https://careers.example/apply?jobId=1234&step=1")
    ).toBe(
      applicationIdentity("https://careers.example/apply?step=2&jobId=1234")
    )
  })

  it("separates jobs, employers, origins and conflicting identities", () => {
    const key = applicationIdentity("https://careers.example/a/jobs/1234")
    expect(key).not.toBeNull()
    expect(key).not.toBe(
      applicationIdentity("https://careers.example/a/jobs/5678")
    )
    expect(key).not.toBe(
      applicationIdentity("https://careers.example/b/jobs/1234")
    )
    expect(key).not.toBe(
      applicationIdentity("https://other.example/a/jobs/1234")
    )
    expect(
      applicationIdentity("https://careers.example/apply?jobId=1234&jobId=5678")
    ).toBeNull()
  })

  it("ignores tracking parameters", () => {
    expect(
      applicationIdentity("https://careers.example/a/jobs/1234?utm_source=x")
    ).toBe(
      applicationIdentity("https://careers.example/a/jobs/1234?utm_source=y")
    )
  })

  it("recognizes an opaque posting id with an application suffix", () => {
    const job =
      "https://jobs.example/company/00000000-0000-4000-8000-000000000001"
    expect(applicationIdentity(job)).toBe(
      applicationIdentity(`${job}/application`)
    )
    expect(applicationIdentity(job)).not.toBeNull()
  })

  it("does not infer identity from a generic apply page or unrelated URL", () => {
    for (const url of [
      "https://careers.example/apply",
      "https://careers.example/login",
      "http://careers.example/jobs/1234",
      "not a url",
    ])
      expect(applicationIdentity(url)).toBeNull()
  })

  it("never treats unknown identities as a match", () => {
    expect(sameApplication(null, null)).toBe(false)
    expect(sameApplication("job:one", "job:one")).toBe(true)
    expect(sameApplication("job:one", "job:two")).toBe(false)
  })
})

describe("temporary state", () => {
  it("separates accounts, tabs and applications", () => {
    const base = { accountId: "acc", tabId: 7, applicationKey: "job:1" }
    const key = temporaryStateKey(base)
    expect(isTemporaryStateKey(key)).toBe(true)
    expect(key).not.toBe(temporaryStateKey({ ...base, tabId: 8 }))
    expect(key).not.toBe(temporaryStateKey({ ...base, accountId: "other" }))
    expect(key).not.toBe(
      temporaryStateKey({ ...base, applicationKey: "job:2" })
    )
  })

  it("gives an unknown application its own key rather than sharing one", () => {
    expect(
      temporaryStateKey({ accountId: "acc", tabId: 7, applicationKey: null })
    ).toContain(UNKNOWN_APPLICATION)
  })

  it("can clear every tab for an account at once", () => {
    expect(
      temporaryStateKey({
        accountId: "acc",
        tabId: 7,
        applicationKey: null,
      }).startsWith(accountStatePrefix("acc"))
    ).toBe(true)
  })
})

describe("source and PDF identity", () => {
  const resumeSource = {
    kind: "resume" as const,
    id: "r1",
    revision: 3,
    contentHash: "h1",
  }
  const profileSource = {
    kind: "profile" as const,
    id: "p1",
    revision: 2,
    contentHash: "h2",
  }
  const sources = [resumeSource, profileSource]
  const render = {
    templateId: "lisbon" as const,
    templateOptions: { pageSize: "A4" as const, fontScale: 1 as const },
    locale: null,
    renderVersion: "fonts-1",
  }

  it("changes when any contributing source changes", () => {
    const id = sourceBundleId(sources)
    expect(sourceBundleId([...sources])).toBe(id)
    expect(
      sourceBundleId([resumeSource, { ...profileSource, revision: 3 }])
    ).not.toBe(id)
    expect(
      sourceBundleId([resumeSource, { ...profileSource, contentHash: "h3" }])
    ).not.toBe(id)
    expect(sourceBundleId([resumeSource])).not.toBe(id)
  })

  it("is not fooled by source order", () => {
    expect(sourceBundleId([...sources].reverse())).toBe(sourceBundleId(sources))
  })

  it("changes the PDF identity for anything that changes the bytes", () => {
    const bundle = sourceBundleId(sources)
    const id = pdfIdentity(bundle, render)
    expect(pdfIdentity(bundle, { ...render })).toBe(id)
    expect(pdfIdentity(sourceBundleId([resumeSource]), render)).not.toBe(id)
    expect(
      pdfIdentity(bundle, { ...render, renderVersion: "fonts-2" })
    ).not.toBe(id)
    expect(
      pdfIdentity(bundle, {
        ...render,
        templateOptions: { ...render.templateOptions, accent: "#1f6feb" },
      })
    ).not.toBe(id)
  })

  it("accepts a pinned bundle and rejects anything the schema does not name", () => {
    const bundle = {
      id: "b1",
      resumeId: "00000000-0000-4000-8000-000000000001",
      resumeVersionId: null,
      sources,
      facts: [fact()],
      render,
    }
    expect(() => SourceBundleSchema.parse(bundle)).not.toThrow()
    expect(() => SourceBundleSchema.parse({ ...bundle, extra: true })).toThrow()
  })
})

describe("provenance and authorization", () => {
  it("accepts a cited source only when the bundle holds it", () => {
    const proposal = {
      questionRef: "q1",
      value: { type: "boolean" as const, value: true, optionRef: "n13" },
      transformation: "copy" as const,
      sources: [
        {
          kind: "profile" as const,
          section: "workAuthorization",
          field: "sponsorship",
        },
      ],
      note: null,
    }
    expect(citedSourcesExist(proposal, [fact()])).toBe(true)
    expect(citedSourcesExist(proposal, [])).toBe(false)
    expect(
      citedSourcesExist(
        {
          ...proposal,
          sources: [
            {
              kind: "profile",
              section: "workAuthorization" as never,
              field: "other" as never,
            },
          ],
        },
        [fact()]
      )
    ).toBe(false)
  })

  it("requires a reviewed choice before replacing an attachment", () => {
    const base = {
      ref: "a1",
      questionRef: "q1",
      type: "attach_file" as const,
      pdfIdentity: "0123456789abcdef",
    }
    expect(
      attachmentIsAuthorized({
        ...base,
        replaceExisting: false,
        replacementConfirmedAt: null,
      })
    ).toBe(true)
    expect(
      attachmentIsAuthorized({
        ...base,
        replaceExisting: true,
        replacementConfirmedAt: null,
      })
    ).toBe(false)
    expect(
      attachmentIsAuthorized({
        ...base,
        replaceExisting: true,
        replacementConfirmedAt: 1,
      })
    ).toBe(true)
  })
})

describe("observation shape", () => {
  const observation = {
    id: "obs1",
    contexts: [
      {
        id: "c1",
        kind: "document",
        url: "https://x.test",
        generation: "g1",
        accessible: true,
      },
    ],
    nodes: [
      {
        ref: "n1",
        contextId: "c1",
        parentRef: null,
        kind: "element",
        tag: "input",
        role: "textbox",
        name: "Email",
        text: null,
        control: {
          kind: "email",
          value: "",
          checked: null,
          multiple: false,
          readonly: false,
          disabled: false,
          options: [],
          accepts: null,
        },
      },
    ],
    regions: [
      { ref: "r1", label: "Contact", nodeRefs: ["n1"], recordRef: null },
    ],
    coverage: { complete: true, gaps: [] },
  }

  it("accepts a bounded observation", () => {
    expect(() => ObservationSchema.parse(observation)).not.toThrow()
  })

  it("rejects anything the run did not describe", () => {
    expect(() =>
      ObservationSchema.parse({ ...observation, extra: true })
    ).toThrow()
    expect(() =>
      ObservationSchema.parse({
        ...observation,
        nodes: [{ ...observation.nodes[0], control: { kind: "nope" } }],
      })
    ).toThrow()
  })

  it("never reports complete while a gap remains", () => {
    const gap = {
      scope: "frame 2",
      reason: "cross_origin" as const,
      detail: "no session",
    }
    expect(observationCoverage([gap], true).complete).toBe(false)
    expect(observationCoverage([], true).complete).toBe(true)
    expect(observationCoverage([], false).complete).toBe(false)
    expect(coverageSummary(observationCoverage([gap], true))).toContain(
      "cross_origin"
    )
  })
})
