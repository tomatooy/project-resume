import { expect, it } from "vitest"
import { validateJevResponse } from "../src/autofill/jev-decider"
import type { DecisionQuestion } from "@workspace/resume-core"
const questions: DecisionQuestion[] = [
  {
    id: "q",
    kind: "semantic",
    instructions: "Choose",
    state: "synthetic",
    candidates: { a: "A", b: "B" },
  },
]
const valid = {
  model: "jev-1.13.0",
  answers: {
    q: {
      type: "choice",
      choice: "a",
      confidence: 0.9,
      probabilities: { a: 0.9, b: 0.1 },
    },
  },
}
it("validates winners and records margins", () => {
  expect(validateJevResponse(valid, questions)).toEqual([
    { id: "q", choice: "a", probability: 0.9, margin: 0.8, tied: false },
  ])
})
it.each([
  { ...valid, model: "jev-latest" },
  { ...valid, answers: { unknown: valid.answers.q } },
  { ...valid, answers: {} },
  { ...valid, answers: { q: { ...valid.answers.q, choice: "b" } } },
  { ...valid, answers: { q: { ...valid.answers.q, confidence: Infinity } } },
  {
    ...valid,
    answers: { q: { ...valid.answers.q, probabilities: { a: 0.9, b: 0.2 } } },
  },
  {
    ...valid,
    answers: {
      q: { ...valid.answers.q, probabilities: { a: 0.9, intruder: 0.1 } },
    },
  },
])("rejects malformed or mismatched response %#", (raw) => {
  expect(validateJevResponse(raw, questions)).toEqual([])
})
it("marks tied winners for review", () => {
  expect(
    validateJevResponse(
      {
        ...valid,
        answers: {
          q: { ...valid.answers.q, probabilities: { a: 0.5, b: 0.5 } },
        },
      },
      questions
    )[0]?.tied
  ).toBe(true)
})

it("pins the model and counts every attempt without nested SDK retries", async () => {
  const { createTypeSafeClient } = await import("@workspace/typesafe")
  const { createJevDecider } = await import("../src/autofill/jev-decider")
  let attempts = 0
  let requests = 0
  const decider = createJevDecider(
    createTypeSafeClient({
      apiKey: "synthetic",
      fetch: async (_url, init) => {
        requests++
        expect(String(init?.body)).toContain('"model":"jev-1.13.0"')
        return requests === 1
          ? Response.json({}, { status: 503, headers: { "retry-after": "0" } })
          : Response.json(valid)
      },
    })
  )
  expect(
    await decider.decide(questions, {
      signal: new AbortController().signal,
      beforeAttempt: async () => {
        attempts++
      },
    })
  ).toHaveLength(1)
  expect(attempts).toBe(2)
  expect(requests).toBe(2)
})
it("stops retries when quota cannot be reserved", async () => {
  const { createTypeSafeClient } = await import("@workspace/typesafe")
  const { createJevDecider } = await import("../src/autofill/jev-decider")
  let requests = 0
  let attempts = 0
  const decider = createJevDecider(
    createTypeSafeClient({
      apiKey: "synthetic",
      fetch: async () => {
        requests++
        return Response.json(
          {},
          { status: 503, headers: { "retry-after": "0" } }
        )
      },
    })
  )
  await expect(
    decider.decide(questions, {
      signal: new AbortController().signal,
      beforeAttempt: async () => {
        if (++attempts > 1) throw new Error("quota")
      },
    })
  ).rejects.toThrow("quota")
  expect(requests).toBe(1)
})
it("shares cancellation with the transport and never retries an aborted call", async () => {
  const { createTypeSafeClient } = await import("@workspace/typesafe")
  const { createJevDecider } = await import("../src/autofill/jev-decider")
  const controller = new AbortController()
  let requests = 0
  const decider = createJevDecider(
    createTypeSafeClient({
      apiKey: "synthetic",
      fetch: async (_url, init) => {
        requests++
        controller.abort()
        expect(init?.signal?.aborted).toBe(true)
        throw new DOMException("Aborted", "AbortError")
      },
    })
  )
  await expect(
    decider.decide(questions, {
      signal: controller.signal,
      beforeAttempt: async () => {},
    })
  ).rejects.toThrow()
  expect(requests).toBe(1)
})
