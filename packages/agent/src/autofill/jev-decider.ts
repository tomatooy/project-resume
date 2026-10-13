import { z } from "zod"
import {
  choice,
  APIConnectionError,
  APITimeoutError,
  APIError,
  type TypeSafeClient,
} from "@workspace/typesafe"
import type {
  AutofillDecider,
  DecisionQuestion,
  DecisionAnswer,
} from "@workspace/resume-core"

const ResponseSchema = z.object({
  model: z.literal("jev-1.13.0"),
  answers: z.record(
    z.string(),
    z.object({
      type: z.literal("choice"),
      choice: z.string(),
      confidence: z.number().finite().min(0).max(1),
      probabilities: z.record(z.string(), z.number().finite().min(0).max(1)),
    })
  ),
})
export function validateJevResponse(
  raw: unknown,
  questions: DecisionQuestion[]
): DecisionAnswer[] {
  const response = ResponseSchema.safeParse(raw)
  if (!response.success) return []
  if (
    Object.keys(response.data.answers).some(
      (id) => !questions.some((q) => q.id === id)
    )
  )
    return []
  return questions.flatMap((q) => {
    const answer = response.data.answers[q.id]
    if (!answer) return []
    const keys = Object.keys(q.candidates)
    const probabilities = Object.entries(answer.probabilities)
    if (
      probabilities.length !== keys.length ||
      probabilities.some(([id]) => !keys.includes(id))
    )
      return []
    if (Math.abs(probabilities.reduce((sum, [, p]) => sum + p, 0) - 1) > 0.0001)
      return []
    const sorted = probabilities.sort((a, b) => b[1] - a[1])
    const first = sorted[0]
    if (!first || answer.probabilities[answer.choice] !== first[1]) return []
    const margin = first[1] - (sorted[1]?.[1] ?? 0)
    return [
      {
        id: q.id,
        choice: answer.choice,
        probability: first[1],
        margin,
        tied: margin === 0,
      },
    ]
  })
}
export function createJevDecider(client: TypeSafeClient): AutofillDecider {
  return {
    async decide(questions, options) {
      if (
        !questions.length ||
        questions.length > 40 ||
        questions.some((q) => Object.keys(q.candidates).length > 202)
      )
        return []
      const signal = AbortSignal.any([
        options.signal,
        AbortSignal.timeout(15000),
      ])
      const state = Object.fromEntries(questions.map((q) => [q.id, q.state]))
      const request = {
        model: "jev-1.13.0",
        state,
        questions: Object.fromEntries(
          questions.map((q) => [
            q.id,
            choice(
              `${q.instructions} Inspect state[${JSON.stringify(q.id)}].`,
              q.candidates
            ),
          ])
        ),
      }
      // UTF-8 byte count is a conservative upper bound for text token budgets.
      if (new TextEncoder().encode(JSON.stringify(request)).byteLength > 30000)
        return []
      for (let attempt = 0; attempt < 2; attempt++) {
        signal.throwIfAborted()
        await options.beforeAttempt()
        try {
          return validateJevResponse(
            await client.systemOne(request, {
              signal,
              timeout: 15000,
              retry: { maxRetries: 0 },
            }),
            questions
          )
        } catch (error) {
          const retryable =
            error instanceof APIConnectionError ||
            error instanceof APITimeoutError ||
            (error instanceof APIError &&
              (error.status === 429 || (error.status ?? 0) >= 500))
          if (!retryable || attempt === 1 || signal.aborted) throw error
          const header =
            error instanceof APIError ? error.headers.get("retry-after") : null
          const seconds = header ? Number(header) : NaN
          const waitMs = header
            ? Number.isFinite(seconds)
              ? seconds * 1000
              : Date.parse(header) - Date.now()
            : 200
          await new Promise<void>((resolve, reject) => {
            const abort = () => {
              clearTimeout(timer)
              reject(new Error("Autofill decision cancelled"))
            }
            const timer = setTimeout(
              () => {
                signal.removeEventListener("abort", abort)
                resolve()
              },
              Math.max(0, Number.isFinite(waitMs) ? waitMs : 200)
            )
            signal.addEventListener("abort", abort, { once: true })
            if (signal.aborted) abort()
          })
        }
      }
      return []
    },
  }
}
