import { createModels, type Models } from "@workspace/agent"

/**
 * Built per request, like the services: the key is read on call so a missing
 * one fails the chat request rather than the import graph, and a rotated
 * secret takes effect without a restart.
 *
 * These are real secrets, so they come from `process.env`, which is where
 * `wrangler secret` and `.dev.vars` land, and never through a `PUBLIC_` name
 * that Vite would inline into the browser bundle. An empty model id or base
 * URL means the provider default; an override is a deploy-time choice.
 */
export function createModelsFromEnv(): Models {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. Add it to apps/web/.dev.vars locally, or `wrangler secret put DEEPSEEK_API_KEY` in production."
    )
  }
  return createModels({
    provider: "deepseek",
    apiKey,
    baseURL: process.env.AI_BASE_URL || undefined,
    modelIds: {
      smart: process.env.AI_MODEL_SMART || undefined,
      fast: process.env.AI_MODEL_FAST || undefined,
    },
  })
}
