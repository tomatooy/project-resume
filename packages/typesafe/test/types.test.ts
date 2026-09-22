import { expectTypeOf, it } from "vitest"

import type {
  APIPromise,
  SystemOneResult,
  TypeSafeClient,
  TypeSafeClientConfig,
} from "../src/index"
import { type questions, request } from "./fixtures"

it("preserves question-specific types through the public client interface", () => {
  // Typechecked but never invoked, so no credential or network access is needed.
  function check(client: TypeSafeClient) {
    const pending = client.systemOne(request)
    expectTypeOf(pending).toEqualTypeOf<
      APIPromise<SystemOneResult<typeof questions>>
    >()

    type Answers = Awaited<typeof pending>["answers"]
    expectTypeOf<Answers["category"]["choice"]>().toEqualTypeOf<
      "billing" | "technical" | "other"
    >()
    expectTypeOf<keyof Answers["category"]["probabilities"]>().toEqualTypeOf<
      "billing" | "technical" | "other"
    >()
    expectTypeOf<Answers["urgency"]["score"]>().toEqualTypeOf<number>()
    expectTypeOf<keyof Answers["urgency"]["probabilities"]>().toEqualTypeOf<
      "0" | "1" | "2"
    >()
    expectTypeOf<Answers["refundRequested"]["noul"]>().toEqualTypeOf<number>()

    // @ts-expect-error Only declared question IDs exist.
    type Missing = Answers["missing"]
    // @ts-expect-error Noul has no separate confidence field.
    type Confidence = Answers["refundRequested"]["confidence"]
    // @ts-expect-error Choice has no score field.
    type Score = Answers["category"]["score"]
    expectTypeOf<Missing | Confidence | Score>()
  }
  expectTypeOf(check).toBeFunction()
  expectTypeOf<TypeSafeClientConfig["apiKey"]>().toEqualTypeOf<string>()
  expectTypeOf<keyof TypeSafeClient>().toEqualTypeOf<"systemOne">()
  expectTypeOf<keyof TypeSafeClientConfig>().toEqualTypeOf<
    "apiKey" | "baseURL" | "defaultModel" | "timeout" | "retry" | "fetch"
  >()
})
