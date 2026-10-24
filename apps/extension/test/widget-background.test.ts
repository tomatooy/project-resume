import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { BLOCKED_TITLE, registerWidget } from "../src/background/widget"

const onMessage = vi.fn<typeof chrome.runtime.onMessage.addListener>()
const onClicked = vi.fn<typeof chrome.action.onClicked.addListener>()
const onInstalled = vi.fn<typeof chrome.runtime.onInstalled.addListener>()
const onRemoved = vi.fn<typeof chrome.tabs.onRemoved.addListener>()
const onReplaced = vi.fn<typeof chrome.tabs.onReplaced.addListener>()
const sendMessage = vi.fn()
const executeScript = vi.fn()
const setTitle = vi.fn(async () => {})
const query = vi.fn()
const local: Record<string, unknown> = {}
const session: Record<string, unknown> = {}
const atsUrl = "https://boards.greenhouse.io/acme/jobs/1"
const tab: chrome.tabs.Tab = {
  lastAccessed: 0,
  id: 1,
  windowId: 4,
  url: "https://www.linkedin.com/jobs/view/123456/",
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
}
const host = { id: "extension", frameId: 0, url: tab.url, tab }
const widget = {
  ...host,
  frameId: 2,
  url: "chrome-extension://extension/widget.html",
}
const panel = {
  ...host,
  frameId: 2,
  url: "chrome-extension://extension/panel.html",
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A host on the page answers pings with this view; null means no host. */
function hostShows(view: "panel" | "widget" | "none" | null) {
  sendMessage.mockImplementation(async (_tabId, message: { type: string }) => {
    if (view === null) throw new Error("Receiving end does not exist.")
    return message.type === "widget-ping" ? { view } : { ok: true }
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(local)) delete local[key]
  for (const key of Object.keys(session)) delete session[key]
  hostShows("panel")
  executeScript.mockResolvedValue([])
  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension",
      getURL: (path: string) => `chrome-extension://extension/${path}`,
      getManifest: () => ({ action: { default_title: "VS:Résumé" } }),
      onMessage: { addListener: onMessage },
      onInstalled: { addListener: onInstalled },
    },
    action: { onClicked: { addListener: onClicked }, setTitle },
    scripting: { executeScript },
    tabs: {
      sendMessage,
      query,
      onRemoved: { addListener: onRemoved },
      onReplaced: { addListener: onReplaced },
    },
    storage: {
      local: {
        get: async () => local,
        set: async (values: Record<string, unknown>) => {
          Object.assign(local, values)
        },
      },
      session: {
        get: async (key: string) =>
          key in session ? { [key]: session[key] } : {},
        set: async (values: Record<string, unknown>) => {
          Object.assign(session, values)
        },
        remove: async (key: string) => {
          delete session[key]
        },
      },
    },
  })
  registerWidget()
})
afterEach(() => vi.unstubAllGlobals())

function request(message: object, sender: chrome.runtime.MessageSender = host) {
  return new Promise<unknown>((resolve) => {
    const accepted = onMessage.mock.calls[0]?.[0](message, sender, resolve)
    if (!accepted) resolve(undefined)
  })
}
const on = (url: string, id = 1) => ({ ...host, url, tab: { ...tab, id, url } })
async function click(target: chrome.tabs.Tab) {
  onClicked.mock.calls[0]?.[0](target)
  await settle()
}

it("opens supported pages as a panel and remembers the widget position", async () => {
  expect(await request({ type: "widget-state" })).toEqual({
    view: "panel",
    position: 0.18,
  })
  expect(await request({ type: "widget-position", position: 0.6 })).toEqual({
    ok: true,
  })
  expect(await request({ type: "widget-state" }, on(atsUrl, 2))).toEqual({
    view: "panel",
    position: 0.6,
  })
  expect(
    await request(
      { type: "widget-state" },
      on("https://www.linkedin.com/feed/")
    )
  ).toEqual({ view: "none", position: 0.6 })
  expect(
    await request({ type: "widget-position", position: 2 })
  ).toBeUndefined()
})

it("minimizes and closes from the panel and reopens from the widget", async () => {
  expect(await request({ type: "panel-minimize" }, panel)).toEqual({ ok: true })
  expect(sendMessage).toHaveBeenCalledWith(
    1,
    { type: "widget-refresh" },
    { frameId: 0 }
  )
  expect(await request({ type: "widget-state" })).toMatchObject({
    view: "widget",
  })
  expect(await request({ type: "widget-open" }, widget)).toEqual({ ok: true })
  expect(await request({ type: "widget-state" })).toMatchObject({
    view: "panel",
  })
  expect(await request({ type: "panel-close" }, panel)).toEqual({ ok: true })
  expect(await request({ type: "widget-state" })).toMatchObject({
    view: "none",
  })
  // Each category keeps its own mode in the tab.
  expect(await request({ type: "widget-state" }, on(atsUrl))).toMatchObject({
    view: "panel",
  })
})

it("closes a dismissed widget for its tab only", async () => {
  await request({ type: "panel-minimize" }, panel)
  expect(await request({ type: "widget-dismiss" })).toEqual({ ok: true })
  expect(await request({ type: "widget-state" })).toMatchObject({
    view: "none",
  })
  expect(
    await request({ type: "widget-state" }, on(tab.url ?? "", 2))
  ).toMatchObject({ view: "panel" })
})

it("follows the tab URL after LinkedIn changes pages without a reload", async () => {
  // sender.url keeps the URL the content script loaded with.
  const moved = { ...host, url: "https://www.linkedin.com/feed/" }
  expect(await request({ type: "widget-state" }, moved)).toMatchObject({
    view: "panel",
  })
  expect(await request({ type: "widget-dismiss" }, moved)).toEqual({
    ok: true,
  })
  expect(session["tab:1"]).toMatchObject({ job: "closed" })
})

it("rejects controls from the wrong frame, extension or page", async () => {
  expect(await request({ type: "widget-open" })).toBeNull()
  expect(
    await request(
      { type: "widget-open" },
      { ...widget, tab: { ...tab, url: "https://example.test/" } }
    )
  ).toBeNull()
  expect(
    await request({ type: "widget-open" }, { ...widget, id: "other" })
  ).toBeUndefined()
  expect(await request({ type: "panel-close" }, widget)).toBeNull()
  expect(await request({ type: "panel-minimize" })).toBeNull()
  expect(await request({ type: "widget-dismiss" }, widget)).toBeNull()
  expect(
    await request({ type: "widget-state" }, { ...host, tab: undefined })
  ).toBeUndefined()
  expect(sendMessage).not.toHaveBeenCalled()
  expect(session).toEqual({})
})

it("toggles the panel from the toolbar on a supported page", async () => {
  await click(tab)
  expect(await request({ type: "widget-state" })).toMatchObject({
    view: "none",
  })
  hostShows("none")
  await click(tab)
  expect(await request({ type: "widget-state" })).toMatchObject({
    view: "panel",
  })
  expect(executeScript).not.toHaveBeenCalled()
})

it("adds a panel to an unsupported page from the toolbar and removes it on the next click", async () => {
  const page = { ...tab, url: "https://example.test/article?x=1" }
  hostShows(null)
  await click(page)
  expect(executeScript).toHaveBeenCalledWith({
    target: { tabId: 1 },
    files: ["widget-host.js"],
  })
  const pageHost = on(page.url)
  expect(await request({ type: "widget-state" }, pageHost)).toMatchObject({
    view: "panel",
  })
  hostShows("panel")
  await click(page)
  expect(executeScript).toHaveBeenCalledOnce()
  expect(await request({ type: "widget-state" }, pageHost)).toMatchObject({
    view: "none",
  })
  expect(setTitle).not.toHaveBeenCalled()
})

it("explains in the tooltip when the toolbar cannot run on a page", async () => {
  hostShows(null)
  await click({ ...tab, url: undefined })
  expect(executeScript).not.toHaveBeenCalled()
  expect(setTitle).toHaveBeenCalledWith({ tabId: 1, title: BLOCKED_TITLE })
  setTitle.mockClear()
  executeScript.mockRejectedValue(new Error("Cannot access contents"))
  await click({ ...tab, url: "https://chromewebstore.google.com/" })
  expect(setTitle).toHaveBeenCalledWith({ tabId: 1, title: BLOCKED_TITLE })
  expect(session["tab:1"]).toMatchObject({ manual: null, blocked: true })
})

it("adds the host to supported tabs that were open before an install or update", async () => {
  query.mockResolvedValue([
    tab,
    { ...tab, id: 2, discarded: true },
    { ...tab, id: undefined },
  ])
  onInstalled.mock.calls[0]?.[0]({ reason: "update", previousVersion: "0.0.9" })
  await settle()
  expect(query).toHaveBeenCalledWith({})
  expect(executeScript).toHaveBeenCalledExactlyOnceWith({
    target: { tabId: 1 },
    files: ["widget-host.js"],
  })
  executeScript.mockClear()
  onInstalled.mock.calls[0]?.[0]({ reason: "chrome_update" })
  await settle()
  expect(executeScript).not.toHaveBeenCalled()
})

it("moves state to a replacement tab and drops it when the tab closes", async () => {
  await request({ type: "panel-close" }, panel)
  onReplaced.mock.calls[0]?.[0](7, 1)
  await settle()
  expect(session["tab:1"]).toBeUndefined()
  expect(session["tab:7"]).toMatchObject({ job: "closed" })
  onRemoved.mock.calls[0]?.[0](7, { windowId: 4, isWindowClosing: false })
  await settle()
  expect(session).toEqual({})
})
