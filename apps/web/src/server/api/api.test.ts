// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRouterClient } from "@orpc/server"
import { createApiClient } from "@workspace/api/client"
import { createServices } from "@workspace/resume-core"
import { inMemoryPorts } from "@workspace/resume-core/testing"
import { WorkerJobFetcher } from "../adapters/job-fetcher"

const deps = vi.hoisted(() => ({
  context: vi.fn(),
  tailoringEnv: vi.fn(),
  getClaims: vi.fn(),
  getSession: vi.fn(),
  setCookie: vi.fn(),
}))
vi.mock("./context", () => ({ createApiContext: deps.context }))
vi.mock("../tailoring/runtime", () => ({ tailoringEnv: deps.tailoringEnv }))
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
    expect(response.headers.get("cache-control")).toBe("private, no-store")
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
  it("stores the extension application link with the fetched job and tailored copy", async () => {
    const applyUrl = "https://jobs.example.test/engineering/123?source=linkedin"
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `<p>${"Build software. ".repeat(30)}</p><a href="${applyUrl}" aria-label="Apply on company website">Apply</a>`
          )
      )
    )
    const ports = inMemoryPorts()
    const services = createServices({
      ...ports,
      jobFetcher: new WorkerJobFetcher(),
    })
    const base = await services.resumes.create({ title: "Base" })
    const posting = await services.tailor.fetchPosting(
      "https://www.linkedin.com/jobs/view/123456/"
    )
    const result = await services.operations.admit({
      sourceResumeId: base.id,
      sourceUrl: posting.url,
      jobText: posting.text,
      platform: "linkedin",
      externalJobId: "123456",
      idempotencyKey: crypto.randomUUID(),
      applyUrl,
      additionalInstruction: "Emphasize backend engineering.",
    })
    expect(posting).not.toHaveProperty("applyUrl")
    if (result.kind !== "bound") throw new Error("Missing binding")
    expect(result.applyUrl).toBe(applyUrl)
    await services.operations.parse(result.operation.id)
    await services.operations.generate(result.operation.id)
    expect(await ports.jobTargets.listForResume(result.resumeId)).toEqual([
      expect.objectContaining({ applyUrl, sourceUrl: posting.url }),
    ])
    expect(ports.resumeTailor.calls[0]?.additionalInstruction).toBe(
      "Emphasize backend engineering."
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
      signal: new AbortController().signal,
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
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
  it("shares paginated contracts across HTTP and SSR without changing the legacy list", async () => {
    const services = createServices(inMemoryPorts())
    for (let i = 0; i < 35; i++)
      await services.resumes.create({ title: `Resume ${i}` })
    const context = {
      services,
      log,
      userId: crypto.randomUUID(),
      accessToken: "test",
      expiresAt: Date.now() / 1000 + 3600,
      authKind: "cookie",
      signal: new AbortController().signal,
    }
    deps.context.mockResolvedValue(context)
    const http = createApiClient({
      baseUrl: "https://app.example.test/api/v1",
      fetch: (request, init) => handleApi(new Request(request, init)),
    })
    const direct = createRouterClient(router, { context })
    const first = await http.resumes.page({})
    expect(first).toEqual(await direct.resumes.page({}))
    expect(first.items).toHaveLength(30)
    expect(first.total).toBe(35)
    const second = await http.resumes.page({
      cursor: first.nextCursor ?? undefined,
    })
    expect(second.items).toHaveLength(5)
    expect(second.nextCursor).toBeNull()
    const row = second.items[0]
    if (!row) throw new Error()
    expect(await http.resumes.summary({ id: row.id })).toEqual(row)
    expect(log.info).toHaveBeenCalledWith("shared_api", {
      procedure: "resumes.summary",
      latencyMs: expect.any(Number),
    })
    expect(await http.resumes.list({})).toHaveLength(35)
    await expect(
      http.resumes.page({ cursor: "invalid" })
    ).rejects.toMatchObject({ code: "VALIDATION" })
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

describe("tailoring configuration admission", () => {
  it.each([btoa("x".repeat(33)), btoa("x".repeat(31)), "not-base64!"])(
    "rejects an invalid key before admitting or retrying a task (%#)",
    async (secret) => {
      const services = createServices(inMemoryPorts())
      const base = await services.resumes.create()
      const admit = vi.spyOn(services.operations, "admit")
      const retry = vi.spyOn(services.operations, "retry")
      const create = vi.fn()
      deps.tailoringEnv.mockResolvedValue({
        TAILOR_ENCRYPTION_KEY_V1: secret,
        TAILOR_WORKFLOW: {
          get: vi.fn().mockRejectedValue(new Error("not found")),
          create,
        },
      })
      const client = createRouterClient(router, {
        context: {
          services,
          log,
          userId: crypto.randomUUID(),
          accessToken: "test",
          expiresAt: Date.now() / 1000 + 3600,
          authKind: "bearer",
          signal: new AbortController().signal,
        },
      })
      const identity = {
        platform: "linkedin",
        externalJobId: "123456",
      } as const
      await expect(
        client.jobs.tailor({
          ...identity,
          sourceResumeId: base.id,
          sourceUrl: "https://www.linkedin.com/jobs/view/123456/",
          jobText:
            "An engineering posting with enough detail to tailor. ".repeat(8),
          idempotencyKey: crypto.randomUUID(),
        })
      ).rejects.toMatchObject({ code: "INTERNAL" })
      await expect(
        client.jobs.retry({
          ...identity,
          expectedOperationId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
        })
      ).rejects.toMatchObject({ code: "INTERNAL" })
      expect(admit).not.toHaveBeenCalled()
      expect(retry).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
      expect(await services.resumes.list()).toHaveLength(1)
      expect(log.error).toHaveBeenCalledWith("tailoring.configuration", {
        errorClass: "invalid_workflow_key",
      })
      expect(JSON.stringify(log.error.mock.calls)).not.toContain(secret)
    }
  )
})

describe("autofill API", () => {
  it("saves, updates and removes explicitly scoped answers over the authenticated API", async () => {
    const services = createServices(inMemoryPorts())
    deps.context.mockResolvedValue({
      services,
      log,
      signal: new AbortController().signal,
    })
    const client = createApiClient({
      baseUrl: "https://app.example.test/api/v1",
      headers: () => ({ Authorization: "Bearer synthetic" }),
      fetch: (request, init) => handleApi(new Request(request, init)),
    })
    const input = {
      expectedRevision: 0,
      meaning: { concept: "relocation" as const },
      conditions: { countryCode: "CA" },
      value: "private confirmed answer",
      confirmed: true as const,
      provenance: { kind: "user" as const },
    }
    const saved = await client.autofillAnswers.save(input)
    expect(await client.autofillAnswers.list({})).toEqual([saved])
    const updated = await client.autofillAnswers.save({
      ...input,
      id: saved.id,
      expectedRevision: saved.revision,
      value: "updated private answer",
    })
    expect(updated.revision).toBe(2)
    await expect(
      client.autofillAnswers.remove({
        id: saved.id,
        expectedRevision: saved.revision,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await client.autofillAnswers.remove({
      id: saved.id,
      expectedRevision: updated.revision,
    })
    expect(await client.autofillAnswers.list({})).toEqual([])
    expect(JSON.stringify(log.info.mock.calls)).not.toContain("private")
  })

  it("serves a stamped PDF source with private caching and no Profile data or logging", async () => {
    const services = createServices(inMemoryPorts())
    deps.context.mockResolvedValue({
      services,
      log,
      signal: new AbortController().signal,
    })
    const resume = await services.resumes.create()
    const profile = await services.autofillProfile.get()
    await services.autofillProfile.update({
      expectedRevision: 0,
      section: "identity",
      data: {
        ...profile.data.identity,
        legalGivenName: "private-profile-value",
      },
    })
    const { sourceStamp } = await services.autofill.prepare({
      resumeId: resume.id,
    })
    const response = await handleApi(
      new Request("https://app.example.test/api/v1/autofill/document", {
        method: "POST",
        headers: {
          Authorization: "Bearer synthetic",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sourceStamp }),
      })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const data = await response.text()
    expect(data).toContain('"resume"')
    expect(data).not.toContain("private-profile-value")
    expect(log.info.mock.calls).toEqual([
      [
        "shared_api",
        { procedure: "autofill.document", latencyMs: expect.any(Number) },
      ],
    ])
  })
  it("supports revision-zero Profile without resumes and returns fixed conflict recovery", async () => {
    const services = createServices(inMemoryPorts())
    deps.context.mockResolvedValue({
      services,
      log,
      signal: new AbortController().signal,
    })
    const client = createApiClient({
      baseUrl: "https://app.example.test/api/v1",
      headers: () => ({ Authorization: "Bearer synthetic" }),
      fetch: (request, init) => handleApi(new Request(request, init)),
    })
    const profile = await client.autofillProfile.get({})
    expect(profile.revision).toBe(0)
    expect(await services.resumes.list()).toEqual([])
    await client.autofillProfile.update({
      expectedRevision: 0,
      section: "identity",
      data: { ...profile.data.identity, legalGivenName: "Synthetic secret" },
    })
    await expect(
      client.autofillProfile.update({
        expectedRevision: 0,
        section: "identity",
        data: profile.data.identity,
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      data: { reasonCode: "profile_conflict" },
    })
    const response = await handleApi(
      new Request("https://app.example.test/api/v1/autofill-profile", {
        headers: { Authorization: "Bearer synthetic" },
      })
    )
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(JSON.stringify(log.info.mock.calls)).not.toContain(
      "Synthetic secret"
    )
  })
  it("rejects oversized bodies before parsing or creating services", async () => {
    const response = await handleApi(
      new Request("https://app.example.test/api/v1/autofill/plan", {
        method: "POST",
        headers: {
          Authorization: "Bearer synthetic",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ snapshot: "x".repeat(262144) }),
      })
    )
    expect(response.status).toBe(413)
    expect(deps.context).not.toHaveBeenCalled()
  })
  it("keeps undeclared profile fields and arbitrary executable plans out of the API", async () => {
    deps.context.mockResolvedValue({
      services: createServices(inMemoryPorts()),
      log,
      signal: new AbortController().signal,
    })
    for (const path of [
      "autofill-profile",
      "autofill/plan",
      "autofill/draft",
      "autofill/answers",
    ]) {
      const response = await handleApi(
        new Request(`https://app.example.test/api/v1/${path}`, {
          method: "POST",
          headers: {
            Authorization: "Bearer synthetic",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: "other",
            op: "execute_script",
            value: "private value",
          }),
        })
      )
      expect(response.status).toBe(400)
      expect(JSON.stringify(await response.json())).not.toContain(
        "private value"
      )
    }
  })
})
