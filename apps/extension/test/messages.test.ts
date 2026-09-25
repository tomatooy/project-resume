import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { Message } from "../src/lib/messages"

const mock = vi.hoisted(() => ({
  account: vi.fn(),
  activePage: vi.fn(),
  lookup: vi.fn(),
  fetchPosting: vi.fn(),
  tailor: vi.fn(),
  retry: vi.fn(),
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
    resumes: { list: vi.fn(async () => []) },
  },
}))
vi.mock("../src/background/navigation", () => ({
  activePage: mock.activePage,
}))
const { handleMessage, trustedPanel } = await import(
  "../src/background/messages"
)
const identity = {
  platform: "linkedin",
  externalJobId: "123456",
} satisfies Extract<Message, { type: "tailor" }>["identity"]
const sourceResumeId = "00000000-0000-4000-8000-000000000001"
const text =
  "Build software and collaborate with the engineering team. ".repeat(8)
const url = "https://www.linkedin.com/jobs/view/123456/"
const message: Message = { type: "tailor", identity, sourceResumeId }
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
  mock.account.mockResolvedValue({ id: "account", email: "user@example.test" })
  mock.activePage.mockResolvedValue(page())
  mock.lookup.mockResolvedValue({ kind: "none" })
  mock.fetchPosting.mockResolvedValue({ url, text })
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(),
        remove: vi.fn(),
      },
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

it("reserves privileged messages for the panel, not the widget or content script", () => {
  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension",
      getURL: (path: string) => `chrome-extension://extension/${path}`,
    },
  })
  expect(
    trustedPanel({
      id: "extension",
      url: "chrome-extension://extension/panel.html",
    })
  ).toBe(true)
  expect(
    trustedPanel({
      id: "extension",
      url: "chrome-extension://extension/widget.html",
    })
  ).toBe(false)
  expect(
    trustedPanel({
      id: "extension",
      url: "https://www.linkedin.com/jobs/view/123456/",
    })
  ).toBe(false)
  expect(
    trustedPanel({
      id: "other",
      url: "chrome-extension://extension/panel.html",
    })
  ).toBe(false)
})

it("allows the embedded panel only inside a LinkedIn tab", () => {
  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension",
      getURL: (path: string) => `chrome-extension://extension/${path}`,
    },
  })
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
  expect(trustedPanel(sender)).toBe(true)
  expect(trustedPanel({ ...sender, frameId: 0 })).toBe(false)
  expect(
    trustedPanel({ ...sender, tab: { ...tab, url: "https://example.test/" } })
  ).toBe(false)
  expect(
    trustedPanel({ ...sender, url: "chrome-extension://extension/widget.html" })
  ).toBe(false)
})

it("fetches through the shared API and submits its canonical URL and text", async () => {
  await handleMessage(message)
  expect(mock.fetchPosting).toHaveBeenCalledWith(identity)
  expect(mock.tailor).toHaveBeenCalledWith({
    ...identity,
    sourceResumeId,
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
  await handleMessage({ type: "state" }, 42)
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
