import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  OpenAIError,
  RateLimitError,
  createOpenAIClient,
  type DecisionRequest,
} from "../src/index"
import { type Fetch, request, result } from "./fixtures"

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn<Fetch>().mockRejectedValue(new Error("Unexpected network call"))
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** Wait for cancellation without opening a connection. */
const untilAborted: Fetch = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    if (!signal) throw new Error("Expected a transport signal")
    const abort = () => reject(new DOMException("Aborted", "AbortError"))
    if (signal.aborted) abort()
    else signal.addEventListener("abort", abort, { once: true })
  })

describe("createOpenAIClient", () => {
  it("preserves mixed answers, refusals, metadata, and method binding", async () => {
    const fetch = vi.fn<Fetch>(async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/decisions")
      expect(init?.method).toBe("POST")
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer test-key"
      )
      expect(init?.body).toBe(
        JSON.stringify({ ...request, model: "gpt-6-luna" })
      )
      return Response.json(result, { headers: { "x-request-id": "request-1" } })
    })
    const client = createOpenAIClient({ apiKey: " test-key ", fetch })
    expect(Object.keys(client)).toEqual(["decisions"])
    expect(Object.keys(client.decisions)).toEqual(["create"])
    const { create } = client.decisions
    const response = await create(request).withResponse()

    expect(response.data).toEqual(result)
    expect(response.request_id).toBe("request-1")
    expect(response.response.status).toBe(200)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("passes through multimodal input and typed choice values", async () => {
    const multimodal: DecisionRequest = {
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Inspect this item." },
            {
              type: "input_image",
              image_url: "https://example.invalid/item.png",
            },
          ],
        },
      ],
      questions: [
        {
          type: "choice",
          name: "damaged",
          instructions: "Is the item damaged?",
          choices: [{ value: true }, { value: false }],
        },
      ],
      safety_identifier: "synthetic-user",
    }
    const fetch = vi.fn<Fetch>(async (_url, init) => {
      expect(init?.body).toBe(
        JSON.stringify({ ...multimodal, model: "gpt-6-luna" })
      )
      return Response.json(result)
    })
    await createOpenAIClient({ apiKey: "test-key", fetch }).decisions.create(
      multimodal
    )
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("uses explicit defaults instead of ambient SDK configuration", async () => {
    vi.stubEnv("OPENAI_API_KEY", "ambient-key")
    vi.stubEnv("OPENAI_ADMIN_KEY", "ambient-admin")
    vi.stubEnv("OPENAI_BASE_URL", "https://ambient.invalid")
    vi.stubEnv("OPENAI_DEFAULT_MODEL", "ambient-model")
    vi.stubEnv("OPENAI_ORG_ID", "ambient-org")
    vi.stubEnv("OPENAI_PROJECT_ID", "ambient-project")
    const fetch = vi.fn<Fetch>(async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/decisions")
      const headers = new Headers(init?.headers)
      expect(headers.get("authorization")).toBe("Bearer explicit-key")
      expect(headers.has("openai-organization")).toBe(false)
      expect(headers.has("openai-project")).toBe(false)
      expect(init?.body).toBe(
        JSON.stringify({ ...request, model: "gpt-6-luna" })
      )
      return Response.json(result)
    })
    await createOpenAIClient({
      apiKey: "explicit-key",
      baseURL: " ",
      defaultModel: " ",
      fetch,
    }).decisions.create(request)
  })

  it.each(["", " \n\t "])("rejects a blank key before transport", (apiKey) => {
    vi.stubEnv("OPENAI_API_KEY", "ambient-key")
    expect(() => createOpenAIClient({ apiKey })).toThrow(OpenAIError)
    expect(() => createOpenAIClient({ apiKey })).toThrow(
      "apiKey must not be empty"
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("honors explicit config and per-request model and header overrides", async () => {
    const fetch = vi.fn<Fetch>(async (url, init) => {
      expect(url).toBe("https://proxy.invalid/v1/decisions")
      const headers = new Headers(init?.headers)
      expect(headers.get("openai-organization")).toBe("org-test")
      expect(headers.get("openai-project")).toBe("project-test")
      const overridden = headers.has("x-correlation-id")
      expect(init?.body).toBe(
        JSON.stringify({
          ...request,
          model: overridden ? "request-model" : "configured-model",
        })
      )
      return Response.json(result)
    })
    const client = createOpenAIClient({
      apiKey: "test-key",
      baseURL: " https://proxy.invalid/v1/ ",
      defaultModel: " configured-model ",
      organization: " org-test ",
      project: " project-test ",
      fetch,
    })
    await client.decisions.create(request)
    await client.decisions.create(
      { ...request, model: "request-model" },
      { headers: { "x-correlation-id": "correlation-1" } }
    )
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("keeps logging off despite ambient or extra logger options", async () => {
    vi.stubEnv("OPENAI_LOG", "debug")
    const logs = [
      vi.spyOn(console, "debug").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
    ]
    const fetch = vi
      .fn<Fetch>()
      .mockImplementationOnce(async () => Response.json(result))
      .mockImplementationOnce(async () =>
        Response.json(
          { error: { message: "Private error body" } },
          { status: 400 }
        )
      )
    const config = { apiKey: "test-key", fetch, logLevel: "debug" }
    const client = createOpenAIClient(config)
    await client.decisions.create(request)
    await expect(client.decisions.create(request)).rejects.toBeInstanceOf(
      APIError
    )
    for (const log of logs) expect(log).not.toHaveBeenCalled()
  })

  it("refuses browser use even when extra options enable it", () => {
    vi.stubGlobal("window", { document: {} })
    vi.stubGlobal("navigator", { userAgent: "browser" })
    const config = { apiKey: "test-key", dangerouslyAllowBrowser: true }
    expect(() => createOpenAIClient(config)).toThrow(/browser/)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("preserves authentication errors and request IDs without retrying", async () => {
    const fetch = vi.fn<Fetch>(async () =>
      Response.json(
        { error: { message: "Invalid credentials" } },
        {
          status: 401,
          headers: { "x-request-id": "auth-1" },
        }
      )
    )
    const pending = createOpenAIClient({
      apiKey: "test-key",
      fetch,
    }).decisions.create(request)
    await expect(pending).rejects.toBeInstanceOf(AuthenticationError)
    await expect(pending).rejects.toMatchObject({
      status: 401,
      requestID: "auth-1",
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("keeps SDK retries and supports per-request retry overrides", async () => {
    const fetch = vi.fn<Fetch>(async () =>
      Response.json({}, { status: 429, headers: { "retry-after-ms": "1" } })
    )
    const client = createOpenAIClient({ apiKey: "test-key", fetch })
    await expect(client.decisions.create(request)).rejects.toBeInstanceOf(
      RateLimitError
    )
    expect(fetch).toHaveBeenCalledTimes(3)
    fetch.mockClear()
    await expect(
      client.decisions.create(request, { maxRetries: 0 })
    ).rejects.toBeInstanceOf(RateLimitError)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("preserves connection errors and configured retry limits", async () => {
    const cause = new Error("Connection unavailable")
    const fetch = vi.fn<Fetch>().mockRejectedValue(cause)
    const pending = createOpenAIClient({
      apiKey: "test-key",
      fetch,
      maxRetries: 0,
    }).decisions.create(request)
    await expect(pending).rejects.toBeInstanceOf(APIConnectionError)
    await expect(pending).rejects.toMatchObject({ cause })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([
    { configured: undefined, override: undefined, expected: 10_000 },
    { configured: 2_000, override: undefined, expected: 2_000 },
    { configured: 2_000, override: 100, expected: 100 },
  ])(
    "honors attempt timeout $expected ms",
    async ({ configured, override, expected }) => {
      vi.useFakeTimers()
      const fetch = vi.fn(untilAborted)
      const client = createOpenAIClient({
        apiKey: "test-key",
        fetch,
        timeout: configured,
        maxRetries: 0,
      })
      const pending = client.decisions.create(
        request,
        override === undefined ? undefined : { timeout: override }
      )
      const assertion = expect(pending).rejects.toBeInstanceOf(
        APIConnectionTimeoutError
      )
      await vi.advanceTimersByTimeAsync(expected)
      await assertion
      expect(fetch).toHaveBeenCalledOnce()
    }
  )

  it.each([false, true])(
    "preserves cancellation (already aborted: %s)",
    async (alreadyAborted) => {
      const controller = new AbortController()
      if (alreadyAborted) controller.abort()
      const fetch = vi.fn<Fetch>((url, init) => {
        const pending = untilAborted(url, init)
        controller.abort()
        return pending
      })
      const client = createOpenAIClient({ apiKey: "test-key", fetch })
      await expect(
        client.decisions.create(request, { signal: controller.signal })
      ).rejects.toBeInstanceOf(APIUserAbortError)
      expect(fetch).toHaveBeenCalledTimes(alreadyAborted ? 0 : 1)
    }
  )
})
