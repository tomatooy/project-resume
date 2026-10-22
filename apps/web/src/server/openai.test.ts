// @vitest-environment node
import type { Decision, DecisionRequest } from "@workspace/openai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { toAppError } from "./errors"
import { createOpenAIClientFromEnv } from "./openai"

const request: DecisionRequest = {
  input: "Example message",
  questions: [
    { type: "predicate", name: "urgent", instructions: "Is this urgent?" },
  ],
}
const result: Decision = {
  model: "gpt-6-luna",
  answers: [{ type: "predicate", name: "urgent", probability: 0.25 }],
  usage: {
    input_tokens: 10,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens: 0,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 10,
  },
}

beforeEach(() => {
  for (const variable of [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_DEFAULT_MODEL",
    "OPENAI_ORG_ID",
    "OPENAI_PROJECT_ID",
  ])
    vi.stubEnv(variable, undefined)
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

describe("createOpenAIClientFromEnv", () => {
  it("imports without credentials and fails only when called", async () => {
    const module = await import("./openai")
    expect(module.createOpenAIClientFromEnv).toBeTypeOf("function")
    expect(() => module.createOpenAIClientFromEnv()).toThrow(
      "OPENAI_API_KEY is not set"
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("treats whitespace-only keys as missing", () => {
    vi.stubEnv("OPENAI_API_KEY", " \n ")
    expect(() => createOpenAIClientFromEnv()).toThrow(
      "OPENAI_API_KEY is not set"
    )
  })

  it("uses defaults when optional environment values are blank", async () => {
    vi.stubEnv("OPENAI_API_KEY", " test-key ")
    for (const variable of [
      "OPENAI_BASE_URL",
      "OPENAI_DEFAULT_MODEL",
      "OPENAI_ORG_ID",
      "OPENAI_PROJECT_ID",
    ])
      vi.stubEnv(variable, " ")
    vi.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/decisions")
      expect(init?.body).toBe(
        JSON.stringify({ ...request, model: "gpt-6-luna" })
      )
      const headers = new Headers(init?.headers)
      expect(headers.get("authorization")).toBe("Bearer test-key")
      expect(headers.has("openai-organization")).toBe(false)
      expect(headers.has("openai-project")).toBe(false)
      return Response.json(result)
    })
    await expect(
      createOpenAIClientFromEnv().decisions.create(request)
    ).resolves.toEqual(result)
    expect(globalThis.fetch).toHaveBeenCalledOnce()
  })

  it("reads configuration and rotated keys on each factory call", async () => {
    vi.stubEnv("OPENAI_API_KEY", "first-key")
    vi.stubEnv("OPENAI_BASE_URL", " https://proxy.invalid/v1/ ")
    vi.stubEnv("OPENAI_DEFAULT_MODEL", " custom-model ")
    vi.stubEnv("OPENAI_ORG_ID", " org-test ")
    vi.stubEnv("OPENAI_PROJECT_ID", " project-test ")
    const first = createOpenAIClientFromEnv()
    vi.stubEnv("OPENAI_API_KEY", "second-key")
    const second = createOpenAIClientFromEnv()
    const keys: (string | null)[] = []
    vi.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
      expect(url).toBe("https://proxy.invalid/v1/decisions")
      expect(init?.body).toBe(
        JSON.stringify({ ...request, model: "custom-model" })
      )
      const headers = new Headers(init?.headers)
      keys.push(headers.get("authorization"))
      expect(headers.get("openai-organization")).toBe("org-test")
      expect(headers.get("openai-project")).toBe("project-test")
      return Response.json(result)
    })
    await first.decisions.create(request)
    await second.decisions.create(request)
    expect(keys).toEqual(["Bearer first-key", "Bearer second-key"])
  })

  it("keeps provider error bodies behind the application error boundary", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key")
    vi.mocked(globalThis.fetch).mockImplementation(async () =>
      Response.json(
        { error: { message: "Private provider message" } },
        { status: 400 }
      )
    )
    const error = await createOpenAIClientFromEnv()
      .decisions.create(request)
      .catch(toAppError)
    expect(error).toMatchObject({
      code: "INTERNAL",
      message: "Something went wrong",
    })
    expect(JSON.stringify(error)).not.toContain("Private provider message")
  })
})
