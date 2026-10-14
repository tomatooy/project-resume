// @vitest-environment node
import {
  CandidateQuestionSchema,
  FactSchema,
} from "@workspace/resume-core/dom-agent"
import { describe, expect, it } from "vitest"

import {
  REASONER_CASES,
  REASONER_FLOOR,
  reportReasoner,
  runReasonerCase,
} from "./evals/reasoner"
import { liveEnabled } from "./evals/live"

/** One live request per case, plus the network the model call needs. */
const LIVE_TIMEOUT_MS = 120_000

/**
 * The grounded-answer table, measured two ways.
 *
 * With no model, the assertions are what the table has to be for a live run to
 * mean anything: every case is a well-formed request, every expectation names a
 * question that exists, and no case asks for an answer and a request about the
 * same question at once. Those hold in CI.
 *
 * The live half runs the table against the model and owns the pass rate. It is
 * off unless `AGENT_EVAL=1` and a key is present, because it needs the network
 * and spends money.
 */
describe("the table the live lane runs", () => {
  it("states every case as a request the port accepts", () => {
    for (const entry of REASONER_CASES) {
      for (const question of entry.questions) {
        CandidateQuestionSchema.parse(question)
      }
      for (const fact of entry.facts) FactSchema.parse(fact)
      expect(entry.facts.length).toBeGreaterThan(0)
    }
  })

  it("names only questions the case asks", () => {
    for (const entry of REASONER_CASES) {
      const refs = new Set(entry.questions.map((question) => question.ref))
      expect(refs.size).toBe(entry.questions.length)
      for (const expected of entry.answers) {
        expect(refs.has(expected.ref), `${entry.name}: ${expected.ref}`).toBe(
          true
        )
      }
      for (const ref of entry.requests) {
        expect(refs.has(ref), `${entry.name}: ${ref}`).toBe(true)
        expect(
          entry.answers.some((expected) => expected.ref === ref),
          `${entry.name}: ${ref} is both expected and refused`
        ).toBe(false)
      }
      expect(entry.answers.length + entry.requests.length).toBeGreaterThan(0)
    }
  })

  it("keeps a floor that a majority has to clear", () => {
    expect(REASONER_FLOOR).toBeGreaterThan(0.5)
    expect(REASONER_FLOOR).toBeLessThanOrEqual(1)
  })
})

const maybe = liveEnabled ? describe : describe.skip

maybe("grounded answers, live", () => {
  it(
    "clears its floor",
    async () => {
      const apiKey = process.env.DEEPSEEK_API_KEY
      expect(apiKey).toBeTruthy()
      const results = await Promise.all(
        REASONER_CASES.map((entry) => runReasonerCase(entry, apiKey as string))
      )
      const reported = reportReasoner(results)
      for (const result of results) {
        if (!result.passed) console.log(`FAIL ${result.name}: ${result.detail}`)
      }
      expect(
        reported.belowFloor,
        `${reported.passed}/${reported.total} cleared the floor`
      ).toBe(false)
    },
    LIVE_TIMEOUT_MS
  )
})
