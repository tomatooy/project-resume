import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { Message } from "../src/lib/messages"

const mock = vi.hoisted(() => ({
  account: vi.fn(),
  activePage: vi.fn(),
  lookup: vi.fn(),
  fetchPosting: vi.fn(),
  tailor: vi.fn(),
  retry: vi.fn(),
  page: vi.fn(),
  summary: vi.fn(),
  preview: vi.fn(),
  storageGet: vi.fn(),
}))
vi.mock("../src/lib/auth", () => ({
  account: mock.account,
  connect: vi.fn(),
  disconnect: vi.fn(),
}))
vi.mock("../src/lib/api", () => ({
  api: {
    jobs: {
      lookup: mock.lookup,
      fetchPosting: mock.fetchPosting,
      tailor: mock.tailor,
      retry: mock.retry,
    },
    resumes: {
      page: mock.page,
      summary: mock.summary,
      preview: mock.preview,
    },
  },
}))
vi.mock("../src/background/navigation", () => ({
  activePage: mock.activePage,
}))
const {
  handleMessage,
  registerMessages,
  trustedPanel,
  resumePageForAccount,
  resumePreviewForJob,
  snapshot,
} = await import("../src/background/messages")
const identity = {
  platform: "linkedin",
  externalJobId: "123456",
} satisfies Extract<Message, { type: "tailor" }>["identity"]
const sourceResumeId = "00000000-0000-4000-8000-000000000001"
const text =
  "Build software and collaborate with the engineering team. ".repeat(8)
const url = "https://www.linkedin.com/jobs/view/123456/"
const message: Message = {
  type: "tailor",
  identity,
  sourceResumeId,
  instructions: "Do not include a summary.",
}
function page(jobId = identity.externalJobId, tabId = 1) {
  return {
    tab: { id: tabId },
    page: {
      kind: "job",
      identity: { ...identity, externalJobId: jobId },
      sourceUrl: `https://www.linkedin.com/jobs/search-results/?currentJobId=${jobId}`,
    },
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  mock.storageGet.mockResolvedValue({})
  mock.account.mockResolvedValue({ id: "account", email: "user@example.test" })
  mock.activePage.mockResolvedValue(page())
  mock.lookup.mockResolvedValue({ kind: "none" })
  mock.page.mockResolvedValue({ items: [], nextCursor: null, total: 0 })
  mock.fetchPosting.mockResolvedValue({ url, text })
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: mock.storageGet,
        set: vi.fn(),
        remove: vi.fn(),
      },
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

const session: Record<string, unknown> = {}
function stubPanelChrome(
  onMessage?: typeof chrome.runtime.onMessage.addListener
) {
  for (const key of Object.keys(session)) delete session[key]
  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension",
      getURL: (path: string) => `chrome-extension://extension/${path}`,
      onMessage: { addListener: onMessage },
    },
    webNavigation: {
      getFrame: async () => ({
        documentId: "host-document",
        documentLifecycle: "active",
      }),
    },
    storage: {
      local: { get: mock.storageGet, set: vi.fn(), remove: vi.fn() },
      session: {
        get: async (key: string) =>
          key in session ? { [key]: session[key] } : {},
      },
    },
  })
}
const tab: chrome.tabs.Tab = {
  id: 1,
  windowId: 1,
  index: 0,
  active: true,
  pinned: false,
  highlighted: true,
  incognito: false,
  selected: true,
  discarded: false,
  autoDiscardable: true,
  groupId: -1,
  frozen: false,
  lastAccessed: 0,
  url: "https://www.linkedin.com/jobs/view/123456/",
}
const sender = {
  id: "extension",
  url: "chrome-extension://extension/panel.html",
  frameId: 2,
  tab,
}

it("reserves privileged messages for the panel, not the widget or content script", async () => {
  stubPanelChrome()
  expect(
    await trustedPanel({
      id: "extension",
      url: "chrome-extension://extension/panel.html",
    })
  ).toBe(true)
  expect(
    await trustedPanel({
      id: "extension",
      url: "chrome-extension://extension/widget.html",
    })
  ).toBe(false)
  expect(
    await trustedPanel({
      id: "extension",
      url: "https://www.linkedin.com/jobs/view/123456/",
    })
  ).toBe(false)
  expect(
    await trustedPanel({
      id: "other",
      url: "chrome-extension://extension/panel.html",
    })
  ).toBe(false)
})

it("trusts an embedded panel only where its tab shows the panel", async () => {
  stubPanelChrome()
  const other = { ...sender, tab: { ...tab, url: "https://example.test/a" } }
  expect(await trustedPanel(sender)).toBe(true)
  expect(await trustedPanel({ ...sender, frameId: 0 })).toBe(false)
  expect(
    await trustedPanel({
      ...sender,
      url: "chrome-extension://extension/widget.html",
    })
  ).toBe(false)
  expect(await trustedPanel(other)).toBe(false)
  session["tab:1"] = {
    job: "widget",
    ats: "panel",
    manual: "https://example.test/a",
    blocked: false,
    hostDocumentId: "host-document",
  }
  expect(await trustedPanel(other)).toBe(true)
  expect(await trustedPanel(sender)).toBe(false)
})

it("refuses an untrusted panel and tells a trusted one which page failed", async () => {
  const listen = vi.fn<typeof chrome.runtime.onMessage.addListener>()
  stubPanelChrome(listen)
  registerMessages()
  const ask = (message: object, from: chrome.runtime.MessageSender) =>
    new Promise<unknown>((resolve) => {
      if (!listen.mock.calls[0]?.[0](message, from, resolve)) resolve(undefined)
    })
  expect(
    await ask(
      { type: "state" },
      { ...sender, tab: { ...tab, url: "https://example.test/" } }
    )
  ).toEqual({
    ok: false,
    code: "unavailable",
    message: "Open VS:Résumé from the toolbar to continue.",
  })
  expect(mock.activePage).not.toHaveBeenCalled()
  expect(await ask({ type: "widget-state" }, sender)).toBeUndefined()
  mock.account.mockRejectedValue(new Error("Sign in again"))
  expect(await ask({ type: "state" }, sender)).toMatchObject({
    ok: false,
    code: "auth",
    page: page().page,
  })
})

it("fetches through the shared API and submits its canonical URL and text", async () => {
  await handleMessage(message)
  expect(mock.fetchPosting).toHaveBeenCalledWith(identity)
  expect(mock.tailor).toHaveBeenCalledWith({
    ...identity,
    sourceResumeId,
    instructions: message.instructions,
    sourceUrl: url,
    jobText: text,
    idempotencyKey: expect.any(String),
  })
})
it.each([
  ["654321", 1],
  ["123456", 2],
])(
  "does not submit if the job or tab changes during fetching (%s, %s)",
  async (jobId, tabId) => {
    mock.activePage
      .mockResolvedValueOnce(page())
      .mockResolvedValue(page(jobId, tabId))
    await expect(handleMessage(message)).rejects.toThrow()
    expect(mock.fetchPosting).toHaveBeenCalledOnce()
    expect(mock.tailor).not.toHaveBeenCalled()
  }
)
it("rejects a fetched posting for another job", async () => {
  mock.fetchPosting.mockResolvedValue({
    url: "https://www.linkedin.com/jobs/view/654321/",
    text,
  })
  await expect(handleMessage(message)).rejects.toThrow()
  expect(mock.tailor).not.toHaveBeenCalled()
})
it("does not submit after the account changes", async () => {
  mock.account
    .mockResolvedValueOnce({ id: "account" })
    .mockResolvedValue({ id: "other" })
  await expect(handleMessage(message)).rejects.toThrow("Account changed")
  expect(mock.tailor).not.toHaveBeenCalled()
})
it("does not generate when the shared fetch fails", async () => {
  mock.fetchPosting.mockRejectedValue(
    Object.assign(new Error("Posting unavailable"), { code: "NOT_FOUND" })
  )
  await expect(handleMessage(message)).rejects.toThrow()
  expect(mock.tailor).not.toHaveBeenCalled()
})
it("does not fetch when the job already has a resume", async () => {
  mock.lookup.mockResolvedValue({ kind: "bound" })
  await handleMessage(message)
  expect(mock.fetchPosting).not.toHaveBeenCalled()
  expect(mock.tailor).not.toHaveBeenCalled()
})

it("reads status for its own tab even when another tab has focus", async () => {
  expect((await handleMessage({ type: "state" }, 42)).tabId).toBe(42)
  expect(mock.activePage).toHaveBeenCalledWith(42)
})
it("rejects an action from a panel belonging to another tab", async () => {
  await expect(handleMessage(message, 42)).rejects.toThrow(
    "The selected job changed"
  )
  expect(mock.fetchPosting).not.toHaveBeenCalled()
  expect(mock.tailor).not.toHaveBeenCalled()
})
it("retries against the saved description without fetching again", async () => {
  await handleMessage({ type: "retry", identity, operationId: sourceResumeId })
  expect(mock.retry).toHaveBeenCalledWith(
    expect.objectContaining({
      ...identity,
      expectedOperationId: sourceResumeId,
    })
  )
  expect(mock.fetchPosting).not.toHaveBeenCalled()
})

it("loads the first page only for an unbound job and validates the remembered resume by ID", async () => {
  mock.storageGet.mockResolvedValue({
    "base:account": sourceResumeId,
  })
  mock.summary.mockResolvedValue({ id: sourceResumeId, title: "Remembered" })
  const result = await snapshot()
  expect(mock.page).toHaveBeenCalledExactlyOnceWith({})
  expect(mock.summary).toHaveBeenCalledExactlyOnceWith({ id: sourceResumeId })
  expect(result.lastBaseId).toBe(sourceResumeId)
  mock.page.mockClear()
  mock.summary.mockClear()
  mock.lookup.mockResolvedValue({ kind: "bound" })
  await snapshot()
  expect(mock.page).not.toHaveBeenCalled()
  expect(mock.summary).not.toHaveBeenCalled()
})
it("forgets a deleted remembered resume", async () => {
  mock.storageGet.mockResolvedValue({
    "base:account": sourceResumeId,
  })
  mock.summary.mockRejectedValue({ code: "NOT_FOUND" })
  expect((await snapshot()).lastBaseId).toBeNull()
  expect(chrome.storage.local.remove).toHaveBeenCalledWith("base:account")
})
it("loads another resume page without repeating the job lookup", async () => {
  await resumePageForAccount({
    type: "resume-page",
    accountId: "account",
    cursor: "cursor",
  })
  expect(mock.page).toHaveBeenCalledExactlyOnceWith({ cursor: "cursor" })
  expect(mock.lookup).not.toHaveBeenCalled()
})
it("discards a page when the account changes during loading", async () => {
  mock.account
    .mockResolvedValueOnce({ id: "account" })
    .mockResolvedValue({ id: "other" })
  await expect(
    resumePageForAccount({ type: "resume-page", accountId: "account" })
  ).rejects.toThrow("Account changed")
})

const previewRequest = {
  accountId: "account",
  identity,
  resumeId: sourceResumeId,
  operationId: sourceResumeId,
}
const ready = {
  kind: "bound",
  resumeId: sourceResumeId,
  operation: { id: sourceResumeId, status: "succeeded" },
}

it("reads a ready preview for its own tab through the authenticated API", async () => {
  mock.lookup.mockResolvedValue(ready)
  mock.preview.mockResolvedValue({ id: sourceResumeId })
  expect(await resumePreviewForJob(previewRequest, 1)).toEqual({
    id: sourceResumeId,
  })
  expect(mock.preview).toHaveBeenCalledExactlyOnceWith({ id: sourceResumeId })
  expect(mock.activePage).toHaveBeenCalledWith(1)
})

it.each(["queued", "running", "failed", "cancelled"])(
  "does not read an unfinished tailored copy (%s)",
  async (status) => {
    mock.lookup.mockResolvedValue({
      ...ready,
      operation: { ...ready.operation, status },
    })
    await expect(resumePreviewForJob(previewRequest, 1)).rejects.toMatchObject({
      code: "changed",
    })
    expect(mock.preview).not.toHaveBeenCalled()
  }
)

it("discards a preview if the selected job changes while it loads", async () => {
  mock.lookup.mockResolvedValue(ready)
  mock.preview.mockImplementation(async () => {
    mock.activePage.mockResolvedValue(page("654321"))
    return { id: sourceResumeId }
  })
  await expect(resumePreviewForJob(previewRequest, 1)).rejects.toMatchObject({
    code: "changed",
  })
})

it("discards a preview if the account changes while it loads", async () => {
  mock.lookup.mockResolvedValue(ready)
  mock.preview.mockImplementation(async () => {
    mock.account.mockResolvedValue({ id: "other" })
    return { id: sourceResumeId }
  })
  await expect(resumePreviewForJob(previewRequest, 1)).rejects.toMatchObject({
    code: "auth",
  })
})

it("discards a preview when its job is rebound during the read", async () => {
  mock.lookup
    .mockResolvedValueOnce(ready)
    .mockResolvedValue({ ...ready, resumeId: crypto.randomUUID() })
  await expect(resumePreviewForJob(previewRequest, 1)).rejects.toMatchObject({
    code: "changed",
  })
})

it("keeps preview documents behind the trusted-panel check", async () => {
  const listen = vi.fn<typeof chrome.runtime.onMessage.addListener>()
  stubPanelChrome(listen)
  registerMessages()
  const reply = await new Promise((respond) => {
    listen.mock.calls[0]?.[0](
      { ...previewRequest, type: "resume-preview" },
      { ...sender, tab: { ...tab, url: "https://example.test/" } },
      respond
    )
  })
  expect(reply).toMatchObject({ ok: false, code: "unavailable" })
  expect(mock.preview).not.toHaveBeenCalled()
})
