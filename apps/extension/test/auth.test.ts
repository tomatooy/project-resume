import type { SupabaseClientOptions } from "@supabase/supabase-js"
import { afterEach, expect, it, vi } from "vitest"
const mock = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
  setAuth: vi.fn(),
  createClient: vi.fn(),
}))
vi.mock("@supabase/supabase-js", () => ({ createClient: mock.createClient }))
afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
function setup() {
  vi.stubEnv("VITE_APP_ORIGIN", "https://app.test")
  vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co")
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public")
  const values: Record<string, string> = {}
  const local = {
    setAccessLevel: vi.fn(async () => {}),
    get: vi.fn(async () => values),
    set: vi.fn(async (input: Record<string, string>) => {
      Object.assign(values, input)
    }),
    remove: vi.fn(async (key: string) => {
      delete values[key]
    }),
  }
  const launchWebAuthFlow = vi.fn()
  vi.stubGlobal("chrome", {
    storage: { local, session: { clear: vi.fn() } },
    identity: {
      getRedirectURL: () =>
        "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/auth/callback",
      launchWebAuthFlow,
    },
  })
  let options: SupabaseClientOptions<"public"> | undefined
  mock.createClient.mockImplementation(
    (_url: string, _key: string, input: SupabaseClientOptions<"public">) => {
      options = input
      return { auth: mock, realtime: { setAuth: mock.setAuth } }
    }
  )
  return { local, launchWebAuthFlow, options: () => options }
}
it("serializes refresh and exposes only an account summary", async () => {
  const fixture = setup()
  mock.getSession.mockResolvedValue({
    data: {
      session: {
        expires_at: 1,
        access_token: "old",
        user: { id: "a", email: "a@example.test" },
      },
    },
  })
  mock.refreshSession.mockResolvedValue({
    data: {
      session: {
        expires_at: Date.now() / 1000 + 3600,
        access_token: "fresh",
        refresh_token: "private",
        user: { id: "a", email: "a@example.test" },
      },
    },
  })
  const auth = await import("../src/lib/auth")
  expect(
    await Promise.all([auth.accessToken(), auth.account(), auth.accessToken()])
  ).toEqual(["fresh", { id: "a", email: "a@example.test" }, "fresh"])
  expect(mock.refreshSession).toHaveBeenCalledTimes(1)
  expect(mock.setAuth).toHaveBeenCalledWith("fresh")
  expect(fixture.local.setAccessLevel).toHaveBeenCalledWith({
    accessLevel: "TRUSTED_CONTEXTS",
  })
  const storage = fixture.options()?.auth?.storage
  await storage?.setItem("session", "persisted")
  expect(await storage?.getItem("session")).toBe("persisted")
  expect(fixture.options()?.auth?.flowType).toBe("pkce")
})
it("rejects an OAuth callback outside the exact extension redirect", async () => {
  const fixture = setup()
  mock.signInWithOAuth.mockResolvedValue({
    data: { url: "https://project.supabase.co/auth/v1/authorize" },
  })
  fixture.launchWebAuthFlow.mockResolvedValue(
    "https://evil.test/auth/callback?code=stolen"
  )
  const auth = await import("../src/lib/auth")
  await expect(auth.connect()).rejects.toThrow("Invalid sign-in callback")
  expect(mock.exchangeCodeForSession).not.toHaveBeenCalled()
})
