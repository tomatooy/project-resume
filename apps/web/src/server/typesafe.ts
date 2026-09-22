import { createTypeSafeClient, type TypeSafeClient } from "@workspace/typesafe"

/** Read on demand so unused features need no key and rotations take effect. */
export function createTypeSafeClientFromEnv(): TypeSafeClient {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim()
  if (!apiKey) {
    throw new Error(
      "TYPESAFE_API_KEY is not set. Add it to apps/web/.dev.vars locally, or `wrangler secret put TYPESAFE_API_KEY` in production."
    )
  }

  return createTypeSafeClient({
    apiKey,
    baseURL: process.env.TYPESAFE_BASE_URL?.trim() || undefined,
    defaultModel: process.env.TYPESAFE_DEFAULT_MODEL?.trim() || undefined,
  })
}
