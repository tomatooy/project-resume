// @vitest-environment node
import { noul } from "@workspace/typesafe"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { toAppError } from "./errors"
import { createTypeSafeClientFromEnv } from "./typesafe"

const request = {
  state: "Example message",
  questions: { urgent: noul("Is this urgent?") },
}
const result = {
  model: "jev-test",
  answers: { urgent: { type: "noul", noul: 0.25 } },
  usage: { input_tokens: 10, output_tokens: 3 },
}

beforeEach(() => {
  vi.stubEnv("TYPESAFE_API_KEY", undefined)
  vi.stubEnv("TYPESAFE_BASE_URL", undefined)
  vi.stubEnv("TYPESAFE_DEFAULT_MODEL", undefined)
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockImplementation(async () => Response.json(result))
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("createTypeSafeClientFromEnv", () => {
  it("imports without credentials and fails only when the factory is called", async () => {
    const module = await import("./typesafe")
    expect(module.createTypeSafeClientFromEnv).toBeTypeOf("function")
    expect(() => module.createTypeSafeClientFromEnv()).toThrow(
      "TYPESAFE_API_KEY is not set"
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("treats whitespace-only keys as missing", () => {
    vi.stubEnv("TYPESAFE_API_KEY", " \n ")
    expect(() => createTypeSafeClientFromEnv()).toThrow(
      "TYPESAFE_API_KEY is not set"
    )
  })

  it("uses defaults when optional environment values are blank", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", " test-key ")
    vi.stubEnv("TYPESAFE_BASE_URL", " ")
    vi.stubEnv("TYPESAFE_DEFAULT_MODEL", " ")
    await expect(
      createTypeSafeClientFromEnv().systemOne(request)
    ).resolves.toEqual(result)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.typesafe.ai/v1/systemone",
      expect.objectContaining({
        body: JSON.stringify({ ...request, model: "jev-latest" }),
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      })
    )
  })

  it("reads config and rotated keys on each factory call", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "first-key")
    vi.stubEnv("TYPESAFE_BASE_URL", " https://proxy.invalid/ ")
    vi.stubEnv("TYPESAFE_DEFAULT_MODEL", " custom-model ")
    const first = createTypeSafeClientFromEnv()
    vi.stubEnv("TYPESAFE_API_KEY", "second-key")
    const second = createTypeSafeClientFromEnv()
    await first.systemOne(request)
    await second.systemOne(request)

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      "https://proxy.invalid/v1/systemone",
      expect.objectContaining({
        body: JSON.stringify({ ...request, model: "custom-model" }),
        headers: expect.objectContaining({ Authorization: "Bearer first-key" }),
      })
    )
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      "https://proxy.invalid/v1/systemone",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer second-key",
        }),
      })
    )
  })

  it("keeps provider error bodies behind the existing application error boundary", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key")
    vi.mocked(globalThis.fetch).mockImplementation(async () =>
      Response.json({ error: "Private provider message" }, { status: 400 })
    )
    const client = createTypeSafeClientFromEnv()
    const pending = client.systemOne(request).catch(toAppError)
    await expect(pending).resolves.toMatchObject({
      code: "INTERNAL",
      message: "Something went wrong",
    })
    expect(JSON.stringify(await pending)).not.toContain(
      "Private provider message"
    )
  })
})
