import { z } from "zod"
import { classifyPage } from "../lib/pages"
import {
  forgetTab,
  moveTab,
  transition,
  updateTabState,
  view,
  ViewSchema,
  type Here,
  type TabEvent,
  type View,
} from "./tab-state"
import { hasPageHost, hereFor } from "./page"
import { autofillFrames } from "./autofill/frames"
import { sendToContent } from "./autofill/send"
import { forgetAutofill, moveAutofill } from "./autofill/session"

const WidgetMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("widget-state") }),
  z.object({
    type: z.literal("widget-position"),
    position: z.number().min(0).max(1),
  }),
  z.object({ type: z.literal("widget-dismiss") }),
  z.object({ type: z.literal("widget-open") }),
  z.object({ type: z.literal("panel-minimize") }),
  z.object({ type: z.literal("panel-close") }),
])
type WidgetMessage = z.infer<typeof WidgetMessage>
const positionKey = "widget:position"
const hostScript = "widget-host.js"
const autofillScript = "autofill.js"
export const BLOCKED_TITLE = "VS:Résumé can't run on this page"

/** Tells the tab's host to fetch its view again. False when no host answers. */
export function refreshHost(tabId: number): Promise<boolean> {
  return chrome.tabs
    .sendMessage(tabId, { type: "widget-refresh" }, { frameId: 0 })
    .then(
      () => true,
      () => false
    )
}

export async function resetTitle(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest()
  const title =
    ("action" in manifest && manifest.action?.default_title) || "VS:Résumé"
  await chrome.action.setTitle({ tabId, title }).catch(() => {})
}

async function apply(tabId: number, here: Here, event: TabEvent) {
  await updateTabState(tabId, (state) => transition(state, here, event))
}

async function hostState(
  tabId: number,
  here: Here,
  documentId: string | undefined
) {
  const [{ after }, saved] = await Promise.all([
    updateTabState(tabId, (state) => ({
      ...transition(state, here, { type: "navigate", document: false }),
      hostDocumentId: documentId ?? state.hostDocumentId,
    })),
    chrome.storage.local.get(positionKey),
  ])
  const position = z.number().min(0).max(1).safeParse(saved[positionKey])
  return {
    view: view(after, here),
    position: position.success ? position.data : 0.18,
  }
}

async function handle(
  message: WidgetMessage,
  sender: chrome.runtime.MessageSender,
  tabId: number
): Promise<unknown> {
  const host = sender.frameId === 0
  const frame = (file: string) =>
    (sender.frameId ?? 0) > 0 && sender.url === chrome.runtime.getURL(file)
  if (!host && !(await hasPageHost(tabId, sender.tab?.url))) return null
  // A content script's sender.url keeps the URL it loaded with, so in-page
  // navigation leaves it behind. The tab URL is current.
  const tab = await hereFor(tabId, sender.tab?.url)
  const change = async (event: TabEvent) => {
    await apply(tabId, tab, event)
    return { ok: await refreshHost(tabId) }
  }
  switch (message.type) {
    case "widget-state":
      return host ? hostState(tabId, tab, sender.documentId) : null
    case "widget-position":
      return host
        ? chrome.storage.local
            .set({ [positionKey]: message.position })
            .then(() => ({ ok: true }))
        : null
    case "widget-dismiss":
      // The host already hid itself.
      return host
        ? apply(tabId, tab, { type: "close" }).then(() => ({ ok: true }))
        : null
    case "widget-open":
      return frame("widget.html") && tab.category !== "unsupported"
        ? change({ type: "open" })
        : null
    case "panel-minimize":
      return frame("panel.html") ? change({ type: "minimize" }) : null
    case "panel-close":
      return frame("panel.html") ? change({ type: "close" }) : null
  }
}

/** The view the tab's host shows, or null when no live host answers. */
async function ping(tabId: number): Promise<View | null> {
  try {
    const reply: unknown = await chrome.tabs.sendMessage(
      tabId,
      { type: "widget-ping" },
      { frameId: 0 }
    )
    const parsed = z.object({ view: ViewSchema }).safeParse(reply)
    return parsed.success ? parsed.data.view : null
  } catch {
    return null
  }
}

async function block(tabId: number, here: Here) {
  await apply(tabId, here, { type: "block" })
  await chrome.action.setTitle({ tabId, title: BLOCKED_TITLE })
}

async function toolbar(tab: chrome.tabs.Tab) {
  const tabId = tab.id
  if (tabId === undefined) return
  await ensureAutofill(tabId)
  const here = await hereFor(tabId, tab.url)
  const showing = await ping(tabId)
  const opening = showing !== "panel"
  // Without a readable URL, Chrome did not grant activeTab: a restricted page.
  if (opening && showing === null && here.location === null)
    return block(tabId, here)
  await apply(tabId, here, { type: "toolbar", opening })
  if (!opening || showing !== null) {
    await refreshHost(tabId)
    return
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [hostScript],
    })
  } catch {
    await block(tabId, here)
    return
  }
  // Covers a live host that missed the ping; a new host fetches on its own.
  await refreshHost(tabId)
  await ensureAutofill(tabId)
}

/** Repair open frames after installation or when the toolbar is opened. */
async function ensureAutofill(tabId: number): Promise<void> {
  const frames = await autofillFrames(tabId)
  await Promise.all(
    frames.map(async (frame) => {
      try {
        await sendToContent(tabId, frame, { type: "autofill-ping" })
      } catch {
        await chrome.scripting
          .executeScript({
            target: { tabId, documentIds: [frame.documentId] },
            files: [autofillScript],
          })
          .catch(() => {})
      }
      await sendToContent(tabId, frame, { type: "autofill-rescan" }).catch(
        () => {}
      )
    })
  )
}

async function injectOpenTabs() {
  const tabs = await chrome.tabs.query({})
  await Promise.all(
    tabs.map(async ({ id: tabId, discarded, url }) => {
      if (tabId === undefined || discarded) return
      if (url && classifyPage(url).kind !== "unsupported")
        await chrome.scripting
          .executeScript({ target: { tabId }, files: [hostScript] })
          .catch(() => {})
      await ensureAutofill(tabId)
    })
  )
}

export function registerWidget() {
  chrome.action.onClicked.addListener((tab) => {
    void toolbar(tab).catch(() => {})
  })
  chrome.runtime.onInstalled.addListener(({ reason }) => {
    // Tabs opened before this version have no host, or an orphaned one.
    if (reason === "install" || reason === "update")
      void injectOpenTabs().catch(() => {})
  })
  chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
    const message = WidgetMessage.safeParse(raw)
    const tabId = sender.tab?.id
    if (!message.success || sender.id !== chrome.runtime.id || !tabId)
      return false
    void handle(message.data, sender, tabId).then(
      (reply) => respond(reply),
      () => respond({ ok: false })
    )
    return true
  })
  chrome.tabs.onRemoved.addListener((tabId) => {
    void forgetTab(tabId).catch(() => {})
    void forgetAutofill(tabId).catch(() => {})
  })
  chrome.tabs.onReplaced.addListener((added, removed) => {
    void moveTab(removed, added).catch(() => {})
    void moveAutofill(removed, added).catch(() => {})
  })
}
