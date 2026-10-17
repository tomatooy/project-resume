import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { observeNavigation } from "../src/background/navigation"
import { initialTabState } from "../src/background/tab-state"

const committed = vi.fn<typeof chrome.webNavigation.onCommitted.addListener>()
const history =
  vi.fn<typeof chrome.webNavigation.onHistoryStateUpdated.addListener>()
const sendMessage = vi.fn(async () => ({ ok: true }))
const setTitle = vi.fn(async () => {})
const session: Record<string, unknown> = {}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function details(
  url: string,
  extra: Partial<chrome.webNavigation.WebNavigationTransitionCallbackDetails> = {}
): chrome.webNavigation.WebNavigationTransitionCallbackDetails {
  return {
    tabId: 2,
    url,
    frameId: 0,
    parentFrameId: -1,
    processId: 1,
    timeStamp: 0,
    documentId: "document",
    documentLifecycle: "active",
    frameType: "outermost_frame",
    transitionType: "link",
    transitionQualifiers: [],
    ...extra,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(session)) delete session[key]
  vi.stubGlobal("chrome", {
    runtime: {
      getManifest: () => ({ action: { default_title: "VS:Résumé" } }),
    },
    action: { setTitle },
    tabs: { sendMessage },
    webNavigation: {
      onCommitted: { addListener: committed },
      onHistoryStateUpdated: { addListener: history },
    },
    storage: {
      session: {
        get: async (key: string) =>
          key in session ? { [key]: session[key] } : {},
        set: async (values: Record<string, unknown>) => {
          Object.assign(session, values)
        },
      },
    },
  })
  observeNavigation()
})
afterEach(() => vi.unstubAllGlobals())

it("follows top-frame navigation only and refreshes the host after in-page changes", async () => {
  session["tab:2"] = { ...initialTabState, manual: "https://example.test/a" }
  committed.mock.calls[0]?.[0](
    details("https://example.test/b", { frameId: 3 })
  )
  committed.mock.calls[0]?.[0](
    details("https://example.test/b", { documentLifecycle: "prerender" })
  )
  history.mock.calls[0]?.[0](details("https://example.test/a?tab=2"))
  await settle()
  expect(session["tab:2"]).toMatchObject({ manual: "https://example.test/a" })
  expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
    2,
    { type: "widget-refresh" },
    { frameId: 0 }
  )
  history.mock.calls[0]?.[0](details("https://example.test/b"))
  await settle()
  expect(session["tab:2"]).toMatchObject({ manual: null })
  expect(sendMessage).toHaveBeenCalledTimes(2)
})

it("does not message a new document, which loads its own host", async () => {
  committed.mock.calls[0]?.[0](
    details("https://www.linkedin.com/jobs/view/123456/")
  )
  await settle()
  expect(sendMessage).not.toHaveBeenCalled()
})

it("restores the toolbar tooltip once the tab loads another document", async () => {
  session["tab:2"] = { ...initialTabState, blocked: true }
  history.mock.calls[0]?.[0](details("https://example.test/b"))
  await settle()
  expect(setTitle).not.toHaveBeenCalled()
  committed.mock.calls[0]?.[0](details("https://example.test/c"))
  await settle()
  expect(session["tab:2"]).toMatchObject({ blocked: false })
  expect(setTitle).toHaveBeenCalledWith({ tabId: 2, title: "VS:Résumé" })
})
