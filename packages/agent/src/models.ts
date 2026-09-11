import { createDeepSeek } from "@ai-sdk/deepseek"
import type { LanguageModel, streamText } from "ai"

/**
 * Two tiers, so the expensive model is a choice per call site rather than a
 * global. The turn loop uses `smart`; memory consolidation uses `fast`. Both
 * default to the same flash model for now; the split is what lets that change
 * per tier without touching a call site.
 */
export type ModelTier = "smart" | "fast"

/**
 * Adding a vendor is one case in `createModels` plus one dependency. Nothing
 * outside this file names a provider.
 */
export type ModelProvider = "deepseek"

export type ModelConfig = {
  provider: ModelProvider
  apiKey: string
  baseURL?: string
  modelIds?: Partial<Record<ModelTier, string>>
}

/**
 * Per-request provider settings, one set per tier. Typed from the SDK's own
 * option rather than hand-rolled, so a provider change that alters the shape
 * is a type error here instead of a rejected request at runtime.
 */
export type ProviderOptions = NonNullable<
  Parameters<typeof streamText>[0]["providerOptions"]
>

export type Models = {
  smart: LanguageModel
  fast: LanguageModel
  /** What to record on the run row. */
  ids: Record<ModelTier, string>
  /** Pass the set belonging to the tier the call site uses. */
  providerOptions: Record<ModelTier, ProviderOptions>
}

export const DEFAULT_MODEL_IDS: Record<
  ModelProvider,
  Record<ModelTier, string>
> = {
  deepseek: { smart: "deepseek-v4-flash", fast: "deepseek-v4-flash" },
}

export function createModels(config: ModelConfig): Models {
  const defaults = DEFAULT_MODEL_IDS[config.provider]
  const ids: Record<ModelTier, string> = {
    smart: config.modelIds?.smart ?? defaults.smart,
    fast: config.modelIds?.fast ?? defaults.fast,
  }

  switch (config.provider) {
    case "deepseek": {
      const deepseek = createDeepSeek({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      })
      return {
        smart: deepseek(ids.smart),
        fast: deepseek(ids.fast),
        ids,
        // V4 reasons by default. `smart` keeps the channel: deliberation
        // belongs in the private one, and `sendReasoning: false` keeps it off
        // the wire. `fast` only produces structured output, where a scratchpad
        // buys nothing.
        providerOptions: {
          smart: { deepseek: { thinking: { type: "disabled" } } },
          fast: { deepseek: { thinking: { type: "disabled" } } },
        },
      }
    }
  }
}
