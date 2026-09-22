import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  RateLimitError,
  TypeSafeError,
  createTypeSafeClient,
  type Fetch,
} from "../src/index"
import { request, result } from "./fixtures"

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

/** A transport that waits for cancellation without opening a connection. */
const untilAborted: Fetch = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    if (!signal) throw new Error("Expected a transport signal")
    const abort = () => reject(new DOMException("Aborted", "AbortError"))
    if (signal.aborted) abort()
    else signal.addEventListener("abort", abort, { once: true })
  })

describe("createTypeSafeClient", () => {
  it("keeps the mixed result, response metadata, and method binding", async () => {
    const fetch = vi.fn<Fetch>(async (url, init) => {
      expect(url).toBe("https://api.typesafe.ai/v1/systemone")
      expect(init?.method).toBe("POST")
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer test-key"
      )
      expect(init?.body).toBe(
        JSON.stringify({ ...request, model: "jev-latest" })
      )
      return Response.json(result, {
        headers: { "x-typesafe-request-id": "request-1" },
      })
    })
    const client = createTypeSafeClient({ apiKey: " test-key ", fetch })
    expect(Object.keys(client)).toEqual(["systemOne"])
    const { systemOne } = client
    const response = await systemOne(request).withResponse()

    expect(response.data).toEqual(result)
    expect(response.requestId).toBe("request-1")
    expect(response.response.status).toBe(200)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("uses explicit defaults instead of SDK environment configuration", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "ambient-key")
    vi.stubEnv("TYPESAFE_BASE_URL", "https://ambient.invalid")
    vi.stubEnv("TYPESAFE_DEFAULT_MODEL", "ambient-model")
    const fetch = vi.fn<Fetch>(async (url, init) => {
      expect(url).toBe("https://api.typesafe.ai/v1/systemone")
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer explicit-key"
      )
      expect(init?.body).toBe(
        JSON.stringify({ ...request, model: "jev-latest" })
      )
      return Response.json(result)
    })
    const client = createTypeSafeClient({
      apiKey: "explicit-key",
      baseURL: " ",
      defaultModel: " ",
      fetch,
    })
    await client.systemOne(request)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each(["", " \n\t "])(
    "rejects a blank key without falling back to the environment",
    (apiKey) => {
      vi.stubEnv("TYPESAFE_API_KEY", "ambient-key")
      expect(() => createTypeSafeClient({ apiKey })).toThrow(TypeSafeError)
      expect(() => createTypeSafeClient({ apiKey })).toThrow(
        "apiKey must not be empty"
      )
      expect(globalThis.fetch).not.toHaveBeenCalled()
    }
  )

  it("allows configuration and per-request model and header overrides", async () => {
    const fetch = vi
      .fn<Fetch>()
      .mockImplementation(async () => Response.json(result))
    const client = createTypeSafeClient({
      apiKey: "test-key",
      baseURL: " https://proxy.invalid/root/ ",
      defaultModel: " configured-model ",
      fetch,
    })
    await client.systemOne(request)
    await client.systemOne(
      { ...request, model: "request-model" },
      { headers: { "x-correlation-id": "correlation-1" } }
    )

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://proxy.invalid/root/v1/systemone",
      expect.objectContaining({
        body: JSON.stringify({ ...request, model: "configured-model" }),
      })
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://proxy.invalid/root/v1/systemone",
      expect.objectContaining({
        body: JSON.stringify({ ...request, model: "request-model" }),
        headers: expect.objectContaining({
          "x-correlation-id": "correlation-1",
        }),
      })
    )
  })

  it("keeps logging off even when the environment or extra options request debug", async () => {
    vi.stubEnv("TYPESAFE_LOG_LEVEL", "debug")
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
        Response.json({ error: "Private error body" }, { status: 400 })
      )
    const config = { apiKey: "test-key", fetch, logLevel: "debug" }
    const client = createTypeSafeClient(config)

    await client.systemOne(request)
    await expect(client.systemOne(request)).rejects.toBeInstanceOf(APIError)
    for (const log of logs) expect(log).not.toHaveBeenCalled()
  })

  it("refuses browser use even if extra options try to allow it", () => {
    vi.stubGlobal("window", { document: {} })
    vi.stubGlobal("navigator", { userAgent: "browser" })
    const config = { apiKey: "test-key", dangerouslyAllowBrowser: true }
    expect(() => createTypeSafeClient(config)).toThrow(/browser/)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("preserves SDK validation before transport", () => {
    const fetch = vi.fn<Fetch>()
    const client = createTypeSafeClient({ apiKey: "test-key", fetch })
    expect(() => client.systemOne({ state: "test", questions: {} })).toThrow(
      TypeSafeError
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it("preserves SDK authentication errors and metadata without retrying", async () => {
    const body = { error: "Invalid credentials" }
    const fetch = vi.fn<Fetch>(async () =>
      Response.json(body, {
        status: 401,
        headers: { "x-typesafe-request-id": "auth-1" },
      })
    )
    const client = createTypeSafeClient({ apiKey: "test-key", fetch })
    const pending = client.systemOne(request)

    await expect(pending).rejects.toBeInstanceOf(AuthenticationError)
    await expect(pending).rejects.toMatchObject({
      status: 401,
      body,
      requestId: "auth-1",
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("retains the default two retries through SDK backoff", async () => {
    const fetch = vi
      .fn<Fetch>()
      .mockImplementationOnce(async () => Response.json({}, { status: 429 }))
      .mockImplementationOnce(async () => Response.json({}, { status: 503 }))
      .mockImplementationOnce(async () => Response.json(result))
    const client = createTypeSafeClient({
      apiKey: "test-key",
      fetch,
      retry: { backoffInitialMs: 1, backoffMaxMs: 1, backoffJitter: 0 },
    })

    await expect(client.systemOne(request)).resolves.toEqual(result)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it("honors a per-request retry override and preserves rate-limit metadata", async () => {
    const fetch = vi.fn<Fetch>(async () =>
      Response.json(
        {},
        {
          status: 429,
          headers: { "retry-after": "3" },
        }
      )
    )
    const client = createTypeSafeClient({ apiKey: "test-key", fetch })
    const pending = client.systemOne(request, { retry: { maxRetries: 0 } })

    await expect(pending).rejects.toBeInstanceOf(RateLimitError)
    await expect(pending).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 3_000,
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("preserves connection errors and configured retry limits", async () => {
    const cause = new Error("Connection unavailable")
    const fetch = vi.fn<Fetch>().mockRejectedValue(cause)
    const client = createTypeSafeClient({
      apiKey: "test-key",
      fetch,
      retry: { maxRetries: 0 },
    })
    const pending = client.systemOne(request)

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
      const client = createTypeSafeClient({
        apiKey: "test-key",
        fetch,
        timeout: configured,
        retry: { maxRetries: 0 },
      })
      const pending = client.systemOne(request, { timeout: override })
      const assertion = expect(pending).rejects.toBeInstanceOf(APITimeoutError)

      await vi.advanceTimersByTimeAsync(expected)
      await assertion
      await expect(pending).rejects.toMatchObject({ timeoutMs: expected })
      expect(fetch).toHaveBeenCalledOnce()
    }
  )

  it.each([false, true])(
    "preserves caller cancellation (already aborted: %s)",
    async (alreadyAborted) => {
      const controller = new AbortController()
      if (alreadyAborted) controller.abort()
      const fetch = vi.fn(untilAborted)
      const client = createTypeSafeClient({ apiKey: "test-key", fetch })
      const pending = client.systemOne(request, { signal: controller.signal })
      const assertion =
        expect(pending).rejects.toBeInstanceOf(APIUserAbortError)
      controller.abort()

      await assertion
      expect(fetch).toHaveBeenCalledOnce()
    }
  )

  it("cancels pending retries through the caller signal", async () => {
    vi.useFakeTimers()
    const timers = vi.spyOn(globalThis, "setTimeout")
    const controller = new AbortController()
    const fetch = vi.fn<Fetch>(async () => Response.json({}, { status: 429 }))
    const client = createTypeSafeClient({
      apiKey: "test-key",
      fetch,
      retry: { backoffInitialMs: 500, backoffJitter: 0 },
    })
    const pending = client.systemOne(request, { signal: controller.signal })
    const assertion = expect(pending).rejects.toBeInstanceOf(APIUserAbortError)

    await vi.waitFor(() =>
      expect(timers).toHaveBeenCalledWith(expect.any(Function), 500)
    )
    controller.abort()
    await assertion
    expect(fetch).toHaveBeenCalledOnce()
  })
})
