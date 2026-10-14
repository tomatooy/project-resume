import {
  type CandidateQuestion,
  DOM_AGENT_LIMITS,
  type Fact,
  type Transformation,
} from "@workspace/resume-core/dom-agent"

import { createPageReasoner } from "../../src/dom-agent/reasoner"
import { createModels } from "../../src/models"

/**
 * Grounded answers, measured against a live model.
 *
 * What no stub can measure is whether the model grounds an answer in the facts
 * it was given. The cases below are ordinary application questions with three
 * shapes of answer: a copy, a lossless conversion, and an observed option. Two
 * of them must come back as a request instead, because no fact in the bundle
 * answers them and the only correct behaviour is to ask.
 *
 * Refusals are counted as failures. The gate refuses ungrounded values, so a
 * model that needs the gate is a model that tried to answer from nothing, and
 * that is the thing this lane exists to notice.
 */

export type ReasonerCase = {
  name: string
  questions: CandidateQuestion[]
  facts: Fact[]
  /** Refs that must come back as answers, with the transformation expected. */
  answers: { ref: string; transformation: Transformation }[]
  /** Refs that must come back as requests for the user. */
  requests: string[]
}

/** What a case must clear to pass. A tripwire, not a quality bar. */
export const REASONER_FLOOR = 0.75

function question(
  ref: string,
  overrides: Partial<CandidateQuestion> = {}
): CandidateQuestion {
  return {
    ref,
    controlRef: `n-${ref}`,
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

const RESUME_SOURCE = {
  kind: "resume" as const,
  resumeId: "11111111-1111-4111-8111-111111111111",
  versionId: null,
  nodeId: "basics",
  field: "name.first",
}

function fact(overrides: Partial<Fact>): Fact {
  return {
    id: "f1",
    meaning: "first name",
    display: "Ada",
    value: { type: "text", text: "Ada" },
    scope: [],
    source: RESUME_SOURCE,
    ...overrides,
  }
}

export const REASONER_CASES: ReasonerCase[] = [
  {
    name: "copies two facts that state exactly what was asked",
    questions: [
      question("q1", { text: "First name" }),
      question("q2", { text: "Email address" }),
    ],
    facts: [
      fact({ id: "f1" }),
      fact({
        id: "f2",
        meaning: "email address",
        display: "ada@example.com",
        value: { type: "text", text: "ada@example.com" },
        source: { ...RESUME_SOURCE, field: "basics.email" },
      }),
    ],
    answers: [
      { ref: "q1", transformation: "copy" },
      { ref: "q2", transformation: "copy" },
    ],
    requests: [],
  },
  {
    name: "selects the option the saved answer means",
    questions: [
      question("q1", {
        kind: "yes_no",
        text: "Are you legally authorized to work in the United States?",
        options: [
          {
            ref: "n-yes",
            label: "Yes",
            value: "yes",
            selected: false,
            disabled: false,
          },
          {
            ref: "n-no",
            label: "No",
            value: "no",
            selected: false,
            disabled: false,
          },
        ],
      }),
    ],
    facts: [
      fact({
        id: "f1",
        meaning: "legally authorized to work in the United States",
        display: "Yes",
        value: { type: "boolean", state: "yes" },
      }),
    ],
    answers: [{ ref: "q1", transformation: "option_equivalent" }],
    requests: [],
  },
  {
    name: "writes a stored month in the exact form the page asks for",
    questions: [question("q1", { text: "Start date (YYYY-MM)" })],
    facts: [
      fact({
        id: "f1",
        meaning: "start date of the current position",
        display: "March 2020",
        value: { type: "date", year: 2020, month: 3, day: null },
      }),
    ],
    answers: [{ ref: "q1", transformation: "format" }],
    requests: [],
  },
  {
    name: "asks for a fact the bundle does not hold",
    questions: [question("q1", { text: "What is your notice period?" })],
    facts: [fact({ id: "f1" })],
    answers: [],
    requests: ["q1"],
  },
  {
    name: "does not fill a question it cannot read",
    questions: [
      question("q1", {
        kind: "unknown",
        text: "How did you hear about us?",
      }),
    ],
    facts: [
      fact({
        id: "f1",
        meaning: "how the applicant heard about the company",
        display: "LinkedIn",
        value: { type: "text", text: "LinkedIn" },
      }),
    ],
    answers: [],
    requests: ["q1"],
  },
]

export type ReasonerCaseResult = {
  name: string
  passed: boolean
  detail: string
}

/** Runs one case against the live model and scores what came back. */
export async function runReasonerCase(
  entry: ReasonerCase,
  apiKey: string
): Promise<ReasonerCaseResult> {
  const reasoner = createPageReasoner(
    createModels({ provider: "deepseek", apiKey })
  )
  const result = await reasoner.reason(
    { questions: entry.questions, facts: entry.facts },
    {
      // One request, one ceiling: the live lane measures the model, so it gets
      // exactly the budget a real request gets.
      signal: AbortSignal.timeout(DOM_AGENT_LIMITS.reasoningRequestMs),
      readContext: async () => null,
    }
  )

  const problems: string[] = []
  if (result.outcome !== "completed") {
    problems.push(`ended ${result.outcome}`)
  }
  for (const expected of entry.answers) {
    const proposal = result.proposals.find(
      (entry) => entry.questionRef === expected.ref
    )
    if (!proposal) problems.push(`did not answer ${expected.ref}`)
    else if (proposal.transformation !== expected.transformation) {
      problems.push(
        `${expected.ref} as ${proposal.transformation}, not ${expected.transformation}`
      )
    }
  }
  for (const ref of entry.requests) {
    if (result.proposals.some((proposal) => proposal.questionRef === ref)) {
      problems.push(`answered ${ref} instead of asking`)
    }
    if (!result.requests.some((request) => request.questionRef === ref)) {
      problems.push(`did not ask about ${ref}`)
    }
  }
  for (const rejection of result.rejections) {
    problems.push(`refused ${rejection.code}`)
  }

  return {
    name: entry.name,
    passed: problems.length === 0,
    detail:
      problems.length > 0
        ? problems.join("; ")
        : `${result.proposals.length} answers, ${result.requests.length} requests, ${result.rounds} rounds`,
  }
}

/** The pass rate, and whether it cleared the floor. */
export function reportReasoner(results: ReasonerCaseResult[]): {
  passed: number
  total: number
  rate: number
  belowFloor: boolean
} {
  const passed = results.filter((entry) => entry.passed).length
  const rate = results.length === 0 ? 1 : passed / results.length
  return {
    passed,
    total: results.length,
    rate,
    belowFloor: rate < REASONER_FLOOR,
  }
}
