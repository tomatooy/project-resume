import type { createApiClient } from "@workspace/api/client"
import { afterEach, expect, it, vi } from "vitest"

type ClientOptions = Parameters<typeof createApiClient>[0]
const mock = vi.hoisted(() => {
  const options: ClientOptions[] = []
  return { options, session: vi.fn(), accessToken: vi.fn() }
})
vi.mock("../src/lib/auth", () => ({
  session: mock.session,
  accessToken: mock.accessToken,
}))
vi.mock("../src/lib/config", () => ({
  config: () => ({ appOrigin: "https://app.test" }),
}))
vi.mock("@workspace/api/client", () => ({
  createApiClient: (options: ClientOptions) => {
    mock.options.push(options)
    return {}
  },
}))
afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mock.options.length = 0
})

it("captures one token from the expected account for the whole client", async () => {
  mock.session.mockResolvedValue({
    user: { id: "account-a" },
    access_token: "token-a",
  })
  const { apiForAccount } = await import("../src/lib/api")
  await apiForAccount("account-a")
  mock.session.mockResolvedValue({
    user: { id: "account-b" },
    access_token: "token-b",
  })
  const headers = mock.options.at(-1)?.headers
  expect(await headers?.()).toEqual({ Authorization: "Bearer token-a" })
  expect(await headers?.()).toEqual({ Authorization: "Bearer token-a" })
  expect(mock.session).toHaveBeenCalledTimes(1)
  expect(mock.accessToken).not.toHaveBeenCalled()
})

it("rejects a missing or changed account before creating a bound client", async () => {
  const { apiForAccount } = await import("../src/lib/api")
  const initial = mock.options.length
  mock.session.mockResolvedValue(null)
  await expect(apiForAccount("account-a")).rejects.toThrow("Account changed")
  mock.session.mockResolvedValue({
    user: { id: "account-b" },
    access_token: "token-b",
  })
  await expect(apiForAccount("account-a")).rejects.toThrow("Account changed")
  expect(mock.options).toHaveLength(initial)
})
