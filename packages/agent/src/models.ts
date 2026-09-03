import { createDeepSeek } from "@ai-sdk/deepseek"
import type { JSONValue, LanguageModel } from "ai"

/**
 * Two tiers, so the expensive model is a choice per call site rather than a
 * global. Skills use `smart`; memory consolidation uses `fast`. Both default
 * to the same flash model for now; the split is what lets that change per
 * tier without touching a call site.
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

/** Per-request provider settings, passed through on every model call. */
export type ProviderOptions = Record<string, Record<string, JSONValue>>

export type Models = {
  smart: LanguageModel
  fast: LanguageModel
  /** What to record on the run row. */
  ids: Record<ModelTier, string>
  providerOptions: ProviderOptions
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
        // Thinking is on by default for V4 and would stream reasoning parts
        // the app neither stores nor shows; patches do not need it.
        providerOptions: { deepseek: { thinking: { type: "disabled" } } },
      }
    }
  }
}
