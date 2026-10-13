// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest"
import { EnvironmentAutofillPolicy } from "./autofill"
afterEach(() => vi.unstubAllEnvs())
it("defaults to no execution and expires policy within sixty seconds", async () => {
  vi.stubEnv("AUTOFILL_ENABLED", "")
  vi.stubEnv("AUTOFILL_JEV_ENABLED", "")
  vi.stubEnv("AUTOFILL_POLICY", "")
  const now = Date.now()
  const policy = await new EnvironmentAutofillPolicy().get()
  expect(policy).toMatchObject({
    enabled: false,
    jevEnabled: false,
    autoRules: [],
    autoModel: [],
  })
  expect(Date.parse(policy.expiresAt) - now).toBeLessThanOrEqual(60100)
})
it("rejects malformed policies and unpinned models", async () => {
  for (const value of [
    "invalid",
    JSON.stringify({ enabled: true, model: "jev-latest" }),
  ]) {
    vi.stubEnv("AUTOFILL_POLICY", value)
    expect((await new EnvironmentAutofillPolicy().get()).enabled).toBe(false)
  }
})
