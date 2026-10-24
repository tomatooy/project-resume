import { classifyPage } from "../lib/pages"
import { hereFor, pageFor } from "./page"
import { transition, updateTabState } from "./tab-state"
import { refreshHost, resetTitle } from "./widget"

export async function activePage(tabId?: number) {
  if (tabId !== undefined) {
    const tab = await chrome.tabs.get(tabId)
    return {
      tab,
      focused: tab.active,
      page: await pageFor(tabId, tab.url),
    }
  }
  const window = await chrome.windows.getLastFocused()
  const [tab] = await chrome.tabs.query({ active: true, windowId: window.id })
  return {
    tab,
    focused: window.focused,
    page:
      tab?.id === undefined
        ? classifyPage(tab?.url ?? "")
        : await pageFor(tab.id, tab.url),
  }
}

/** Applies a top-frame navigation to the tab's display state. */
export async function settle(tabId: number, url: string, document: boolean) {
  const here = await hereFor(tabId, url)
  const { before, after } = await updateTabState(tabId, (state) =>
    transition(state, here, { type: "navigate", document })
  )
  if (before.blocked && !after.blocked) await resetTitle(tabId)
}

export function observeNavigation() {
  // Unfiltered: a panel opened from the toolbar can sit on any site.
  chrome.webNavigation.onCommitted.addListener((event) => {
    if (event.frameId !== 0 || event.documentLifecycle === "prerender") return
    // A new document mounts its own host, which asks for its view.
    void settle(event.tabId, event.url, true).catch(() => {})
  })
  chrome.webNavigation.onHistoryStateUpdated.addListener((event) => {
    if (event.frameId !== 0 || event.documentLifecycle === "prerender") return
    void settle(event.tabId, event.url, false)
      .catch(() => {})
      .then(() => refreshHost(event.tabId))
  })
}
