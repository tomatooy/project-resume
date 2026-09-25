import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { registerWidget } from "../src/background/widget"

const addListener = vi.fn<typeof chrome.runtime.onMessage.addListener>()
const open = vi.fn(async () => {})
const local: Record<string, number> = {}
const session: Record<string, boolean> = {}
const tab = {
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
beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(local)) delete local[key]
  for (const key of Object.keys(session)) delete session[key]
  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension",
      getURL: (path: string) => `chrome-extension://extension/${path}`,
      onMessage: { addListener },
    },
    action: { onClicked: { addListener: vi.fn() } },
    tabs: { sendMessage: open, onRemoved: { addListener: vi.fn() } },
    storage: {
      local: {
        get: vi.fn(async () => local),
        set: vi.fn(async (value: Record<string, number>) =>
          Object.assign(local, value)
        ),
      },
      session: {
        get: vi.fn(async () => session),
        set: vi.fn(async (value: Record<string, boolean>) =>
          Object.assign(session, value)
        ),
        remove: vi.fn(async (key: string) => {
          delete session[key]
        }),
      },
    },
  })
  registerWidget()
})
afterEach(() => vi.unstubAllGlobals())
function request(message: object, sender: chrome.runtime.MessageSender = host) {
  return new Promise<unknown>((resolve) => {
    const accepted = addListener.mock.calls[0]?.[0](message, sender, resolve)
    if (!accepted) resolve(undefined)
  })
}
it("remembers vertical position and dismissal without exposing account storage", async () => {
  expect(await request({ type: "widget-state" })).toEqual({
    visible: true,
    position: 0.18,
  })
  await request({ type: "widget-position", position: 0.6 })
  await request({ type: "widget-dismiss" })
  expect(await request({ type: "widget-state" })).toEqual({
    visible: false,
    position: 0.6,
  })
  expect(
    await request({ type: "widget-state" }, { ...host, tab: { ...tab, id: 2 } })
  ).toEqual({ visible: true, position: 0.6 })
})
it("opens the panel in the requesting tab and restores a dismissed widget", async () => {
  await request({ type: "widget-dismiss" })
  const reply = request({ type: "widget-open" }, widget)
  expect(await reply).toEqual({ ok: true })
  expect(open).toHaveBeenCalledWith(1, { type: "panel-open" }, { frameId: 0 })
  expect(await request({ type: "widget-state" })).toMatchObject({
    visible: true,
  })
})
it("rejects non-widget open requests and unsupported tabs", async () => {
  expect(await request({ type: "widget-open" })).toBeUndefined()
  expect(
    await request(
      { type: "widget-open" },
      { ...widget, tab: { ...tab, url: "https://example.test" } }
    )
  ).toBeUndefined()
  expect(
    await request({ type: "widget-open" }, { ...widget, id: "other" })
  ).toBeUndefined()
  expect(open).not.toHaveBeenCalled()
})
it("keeps unsupported pages hidden and rejects invalid position input", async () => {
  expect(
    await request(
      { type: "widget-state" },
      { ...host, url: "https://www.linkedin.com/feed/" }
    )
  ).toMatchObject({ visible: false })
  expect(
    await request({ type: "widget-position", position: 2 })
  ).toBeUndefined()
  expect(local).toEqual({})
})
