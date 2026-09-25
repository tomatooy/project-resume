// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRouterClient } from "@orpc/server"
import { createApiClient } from "@workspace/api/client"
import { createServices } from "@workspace/resume-core"
import { inMemoryPorts } from "@workspace/resume-core/testing"
import { WorkerJobFetcher } from "../adapters/job-fetcher"

const deps = vi.hoisted(() => ({
  context: vi.fn(),
  getClaims: vi.fn(),
  getSession: vi.fn(),
  setCookie: vi.fn(),
}))
vi.mock("./context", () => ({ createApiContext: deps.context }))
const { handleApi, checkOrigin } = await import("./handler")
const { router } = await import("./router")
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => vi.unstubAllGlobals())
describe("shared API HTTP and SSR", () => {
  it("fetches a posting through the same service and Worker adapter as the web app", async () => {
    const text = "Build useful software with our engineering team. "
      .repeat(8)
      .trim()
    const fetchPage = vi.fn(
      async () => new Response(`<script>private</script><p>${text}</p>`)
    )
    vi.stubGlobal("fetch", fetchPage)
    const services = createServices({
      ...inMemoryPorts(),
      jobFetcher: new WorkerJobFetcher(),
    })
    deps.context.mockResolvedValue({ services, log })
    const response = await handleApi(
      new Request(
        "https://app.example.test/api/v1/jobs/linkedin/123456/posting",
        { method: "POST", headers: { Authorization: "Bearer test" } }
      )
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      url: "https://www.linkedin.com/jobs/view/123456/",
      text,
    })
    expect(fetchPage).toHaveBeenCalledWith(
      "https://www.linkedin.com/jobs/view/123456/",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(response.headers.get("cache-control")).toBe("no-store")
    const client = createApiClient({
      baseUrl: "https://app.example.test/api/v1",
      headers: () => ({ Authorization: "Bearer test" }),
      fetch: (request, init) => handleApi(new Request(request, init)),
    })
    expect(
      await client.jobs.fetchPosting({
        platform: "linkedin",
        externalJobId: "123456",
      })
    ).toEqual(
      await services.tailor.fetchPosting(
        "https://www.linkedin.com/jobs/view/123456/"
      )
    )
  })
  it("preserves the web service's unreadable-posting failure", async () => {
    deps.context.mockResolvedValue({
      services: createServices(inMemoryPorts()),
      log,
    })
    const response = await handleApi(
      new Request(
        "https://app.example.test/api/v1/jobs/linkedin/123456/posting",
        { method: "POST", headers: { Authorization: "Bearer test" } }
      )
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" })
  })
  it("uses the same validated list implementation for cookie, bearer and direct SSR", async () => {
    const services = createServices(inMemoryPorts())
    await services.resumes.create({ title: "Test base" })
    const context = {
      services,
      log,
      userId: crypto.randomUUID(),
      accessToken: "test",
      expiresAt: Date.now() / 1000 + 3600,
      authKind: "cookie",
    }
    deps.context.mockResolvedValue(context)
    const transport: typeof fetch = (request, init) =>
      handleApi(new Request(request, init))
    const http = createApiClient({
      baseUrl: "https://app.example.test/api/v1",
      fetch: transport,
    })
    const bearer = createApiClient({
      baseUrl: "https://app.example.test/api/v1",
      fetch: transport,
      headers: () => ({ Authorization: "Bearer test" }),
    })
    // Context carries the authenticated service graph; the direct path is request-local.
    const direct = createRouterClient(router, { context })
    const expected = await services.resumes.list()
    expect(await http.resumes.list({})).toEqual(expected)
    expect(await bearer.resumes.list({})).toEqual(expected)
    expect(await direct.resumes.list({})).toEqual(expected)
    const response = await handleApi(
      new Request("https://app.example.test/api/v1/resumes")
    )
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
  it("rejects cookie mutations without same-origin protection", () => {
    expect(
      checkOrigin(
        new Request(
          "https://app.example.test/api/v1/jobs/linkedin/123456/tailor",
          { method: "POST" }
        ),
        []
      )
    ).toBe(false)
    expect(
      checkOrigin(
        new Request(
          "https://app.example.test/api/v1/jobs/linkedin/123456/tailor",
          { method: "POST", headers: { Origin: "https://evil.example.test" } }
        ),
        []
      )
    ).toBe(false)
    expect(
      checkOrigin(
        new Request(
          "https://app.example.test/api/v1/jobs/linkedin/123456/tailor",
          { method: "POST", headers: { Origin: "https://app.example.test" } }
        ),
        []
      )
    ).toBe(true)
  })
  it("allows only configured extension origins and never caches preflight", async () => {
    const origin = `chrome-extension://${"a".repeat(32)}`
    vi.stubEnv("EXTENSION_ORIGINS", origin)
    const allowed = await handleApi(
      new Request("https://app.example.test/api/v1/resumes", {
        method: "OPTIONS",
        headers: { Origin: origin },
      })
    )
    expect(allowed.status).toBe(204)
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(origin)
    const denied = await handleApi(
      new Request("https://app.example.test/api/v1/resumes", {
        headers: { Origin: "https://evil.test", Authorization: "Bearer test" },
      })
    )
    expect(denied.status).toBe(403)
    vi.unstubAllEnvs()
  })
  it("maps malformed route identities to the shared validation error", async () => {
    deps.context.mockResolvedValue({ services: {}, log })
    const response = await handleApi(
      new Request("https://app.example.test/api/v1/jobs/other/123456")
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "VALIDATION" })
  })
  it("does not expose invalid stored results as a successful list", async () => {
    deps.context.mockResolvedValue({
      services: { resumes: { list: () => [{ id: "broken" }] } },
      log,
    })
    const response = await handleApi(
      new Request("https://app.example.test/api/v1/resumes")
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: "INTERNAL" })
  })
})
