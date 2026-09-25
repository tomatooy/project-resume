import { linkedinExtensionPage } from "@workspace/resume-core/contracts"

export async function activePage(tabId?: number) {
  if (tabId !== undefined) {
    const tab = await chrome.tabs.get(tabId)
    return {
      tab,
      focused: tab.active,
      page: linkedinExtensionPage(tab.url ?? ""),
    }
  }
  const window = await chrome.windows.getLastFocused()
  const [tab] = await chrome.tabs.query({ active: true, windowId: window.id })
  return {
    tab,
    focused: window.focused,
    page: linkedinExtensionPage(tab?.url ?? ""),
  }
}
export function observeNavigation() {
  const refresh = (tabId: number) => {
    void chrome.tabs
      .sendMessage(tabId, { type: "widget-refresh" }, { frameId: 0 })
      .catch(() => {
        /* The content script mounts on the next supported page load. */
      })
  }
  chrome.tabs.onUpdated.addListener((id, change) => {
    if (change.url || change.status === "complete") refresh(id)
  })
  chrome.tabs.onActivated.addListener((info) => refresh(info.tabId))
  chrome.webNavigation.onHistoryStateUpdated.addListener(
    (event) => {
      if (event.frameId === 0) refresh(event.tabId)
    },
    { url: [{ hostEquals: "www.linkedin.com" }] }
  )
}
