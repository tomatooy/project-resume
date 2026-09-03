import { createModels, type Models } from "@workspace/agent"

import { aiBaseUrl, aiModelIds, deepseekApiKey } from "./env"

/**
 * Built per request, like the services: the key is read on call so a missing
 * one fails the chat request rather than the import graph, and a rotated
 * secret takes effect without a restart.
 */
export function createModelsFromEnv(): Models {
  return createModels({
    provider: "deepseek",
    apiKey: deepseekApiKey(),
    baseURL: aiBaseUrl(),
    modelIds: aiModelIds(),
  })
}
