import { createOpenAIClient, type OpenAIClient } from "@workspace/openai"

/** Read on demand so unused features need no key and rotations take effect. */
export function createOpenAIClientFromEnv(): OpenAIClient {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to apps/web/.dev.vars locally, or `wrangler secret put OPENAI_API_KEY` in production."
    )
  }

  return createOpenAIClient({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
    defaultModel: process.env.OPENAI_DEFAULT_MODEL?.trim() || undefined,
    organization: process.env.OPENAI_ORG_ID?.trim() || undefined,
    project: process.env.OPENAI_PROJECT_ID?.trim() || undefined,
  })
}
