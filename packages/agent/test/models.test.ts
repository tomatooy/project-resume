import { describe, expect, it } from "vitest"

import { DEFAULT_MODEL_IDS, createModels } from "../src/models"

describe("createModels", () => {
  it("defaults both tiers to the flash model", () => {
    const models = createModels({ provider: "deepseek", apiKey: "k" })
    expect(models.ids).toEqual({
      smart: "deepseek-v4-flash",
      fast: "deepseek-v4-flash",
    })
    expect(DEFAULT_MODEL_IDS.deepseek.smart).toBe("deepseek-v4-flash")
  })

  it("lets each tier be overridden independently", () => {
    const models = createModels({
      provider: "deepseek",
      apiKey: "k",
      modelIds: { smart: "deepseek-v4-pro" },
    })
    expect(models.ids).toEqual({
      smart: "deepseek-v4-pro",
      fast: "deepseek-v4-flash",
    })
  })

  it("gives the smart tier a private channel and keeps the fast tier flat", () => {
    const models = createModels({ provider: "deepseek", apiKey: "k" })
    expect(models.providerOptions.smart).toEqual({
      deepseek: { thinking: { type: "enabled" } },
    })
    expect(models.providerOptions.fast).toEqual({
      deepseek: { thinking: { type: "disabled" } },
    })
  })
})
