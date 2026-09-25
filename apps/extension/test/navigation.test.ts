import { afterEach, expect, it, vi } from "vitest"
import { observeNavigation } from "../src/background/navigation"

afterEach(() => vi.unstubAllGlobals())
it("refreshes the widget on navigation without opening a popup or panel", () => {
  const updated = vi.fn<typeof chrome.tabs.onUpdated.addListener>()
  const activated = vi.fn<typeof chrome.tabs.onActivated.addListener>()
  const history =
    vi.fn<typeof chrome.webNavigation.onHistoryStateUpdated.addListener>()
  const sendMessage = vi.fn(async () => {})
  vi.stubGlobal("chrome", {
    tabs: {
      sendMessage,
      onUpdated: { addListener: updated },
      onActivated: { addListener: activated },
    },
    webNavigation: { onHistoryStateUpdated: { addListener: history } },
  })
  observeNavigation()
  const tab = {
    lastAccessed: 0,
    id: 2,
    index: 0,
    windowId: 1,
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
  updated.mock.calls[0]?.[0](
    2,
    { url: "https://www.linkedin.com/jobs/view/123456/" },
    tab
  )
  activated.mock.calls[0]?.[0]({ tabId: 2, windowId: 1 })
  expect(sendMessage).toHaveBeenCalledTimes(2)
  expect(sendMessage).toHaveBeenLastCalledWith(
    2,
    { type: "widget-refresh" },
    { frameId: 0 }
  )
  expect(history).toHaveBeenCalledOnce()
})
