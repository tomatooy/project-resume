import { expectTypeOf, it } from "vitest"

import type {
  APIPromise,
  Decision,
  DecisionRequest,
  OpenAIClient,
  OpenAIClientConfig,
} from "../src/index"
import { request } from "./fixtures"

it("preserves native answer narrowing and SDK promise helpers", () => {
  async function check(client: OpenAIClient) {
    const pending = client.decisions.create(request)
    expectTypeOf(pending).toEqualTypeOf<APIPromise<Decision>>()
    const { answers } = await pending
    for (const answer of answers) {
      expectTypeOf(answer.name).toEqualTypeOf<string | null>()
      if (answer.type === "predicate") {
        expectTypeOf(answer.probability).toEqualTypeOf<number>()
        // @ts-expect-error Predicates have no separate confidence.
        expectTypeOf(answer.confidence)
      } else if (answer.type === "choice") {
        expectTypeOf(answer.choice).toEqualTypeOf<string | boolean>()
        expectTypeOf(answer.confidence).toEqualTypeOf<number>()
      } else if (answer.type === "score") {
        expectTypeOf(answer.score).toEqualTypeOf<number>()
      } else {
        expectTypeOf(answer.type).toEqualTypeOf<"refusal">()
        // @ts-expect-error A refusal has no fabricated probability.
        expectTypeOf(answer.probability)
      }
    }
  }
  expectTypeOf(check).toBeFunction()
  expectTypeOf<DecisionRequest["model"]>().toEqualTypeOf<string | undefined>()
  expectTypeOf<OpenAIClientConfig["apiKey"]>().toEqualTypeOf<string>()
  expectTypeOf<keyof OpenAIClient>().toEqualTypeOf<"decisions">()
  expectTypeOf<keyof OpenAIClient["decisions"]>().toEqualTypeOf<"create">()
  expectTypeOf<keyof OpenAIClientConfig>().toEqualTypeOf<
    | "apiKey"
    | "baseURL"
    | "defaultModel"
    | "organization"
    | "project"
    | "timeout"
    | "maxRetries"
    | "fetch"
  >()
})
