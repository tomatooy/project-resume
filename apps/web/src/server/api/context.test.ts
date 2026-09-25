// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  bearer: vi.fn(),
  requireUser: vi.fn(),
  getSession: vi.fn(),
}))
vi.mock("../auth/supabase", () => ({ createSupabaseForRequest: mocks.cookies }))
vi.mock("../auth/bearer", () => ({ verifyBearer: mocks.bearer }))
vi.mock("../auth/require-user", () => ({ requireUser: mocks.requireUser }))
vi.mock("../container", () => ({ supabasePorts: () => ({}) }))
vi.mock("@workspace/resume-core", async (original) => ({
  ...(await original<typeof import("@workspace/resume-core")>()),
  createServices: () => ({}),
}))
const { createApiContext } = await import("./context")
beforeEach(() => {
  vi.clearAllMocks()
  mocks.cookies.mockReturnValue({ auth: { getSession: mocks.getSession } })
})
it("never falls back to cookies after a supplied invalid bearer", async () => {
  mocks.bearer.mockRejectedValue(new Error("Invalid token"))
  await expect(
    createApiContext(
      new Request("https://app.test/api/v1/resumes", {
        headers: { Authorization: "Bearer invalid" },
      })
    )
  ).rejects.toThrow()
  expect(mocks.cookies).not.toHaveBeenCalled()
  await expect(
    createApiContext(
      new Request("https://app.test/api/v1/resumes", {
        headers: { Authorization: "Basic invalid" },
      })
    )
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" })
})
it("resolves fresh cookie contexts independently and retains refreshed tokens", async () => {
  mocks.requireUser
    .mockResolvedValueOnce({ userId: "user-a" })
    .mockResolvedValueOnce({ userId: "user-b" })
  mocks.getSession.mockResolvedValue({
    data: {
      session: {
        access_token: "refreshed-token",
        expires_at: Date.now() / 1000 + 3600,
      },
    },
  })
  const first = await createApiContext(
    new Request("https://app.test/api/v1/resumes")
  )
  const second = await createApiContext(
    new Request("https://app.test/api/v1/resumes")
  )
  expect(first.userId).toBe("user-a")
  expect(second.userId).toBe("user-b")
  expect(first.accessToken).toBe("refreshed-token")
  expect(mocks.cookies).toHaveBeenCalledTimes(2)
})
