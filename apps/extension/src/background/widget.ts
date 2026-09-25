import { z } from "zod"
import { linkedinExtensionPage } from "@workspace/resume-core/contracts"

const WidgetMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("widget-state") }),
  z.object({
    type: z.literal("widget-position"),
    position: z.number().min(0).max(1),
  }),
  z.object({ type: z.literal("widget-dismiss") }),
  z.object({ type: z.literal("widget-open") }),
])
const positionKey = "widget:position"
export function registerWidget() {
  const openPanel = async (tabId: number) => {
    await chrome.storage.session.remove(`widget:hidden:${tabId}`)
    await chrome.tabs.sendMessage(tabId, { type: "panel-open" }, { frameId: 0 })
  }
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id && linkedinExtensionPage(tab.url ?? "").kind !== "unsupported")
      void openPanel(tab.id).catch(() => {})
  })
  chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
    const message = WidgetMessage.safeParse(raw)
    if (!message.success || sender.id !== chrome.runtime.id || !sender.tab?.id)
      return false
    const tabId = sender.tab.id
    const hiddenKey = `widget:hidden:${tabId}`
    const widget = sender.url === chrome.runtime.getURL("widget.html")
    const host =
      sender.frameId === 0 &&
      sender.url?.startsWith("https://www.linkedin.com/")
    if (message.data.type === "widget-open") {
      if (
        !widget ||
        linkedinExtensionPage(sender.tab.url ?? "").kind === "unsupported"
      )
        return false
      void openPanel(tabId).then(
        () => respond({ ok: true }),
        () => respond({ ok: false })
      )
      return true
    }
    if (!host) return false
    const data = message.data
    void (async () => {
      if (data.type === "widget-dismiss") {
        await chrome.storage.session.set({ [hiddenKey]: true })
        return { ok: true }
      }
      if (data.type === "widget-position") {
        await chrome.storage.local.set({ [positionKey]: data.position })
        return { ok: true }
      }
      const [saved, session] = await Promise.all([
        chrome.storage.local.get(positionKey),
        chrome.storage.session.get(hiddenKey),
      ])
      const position = z.number().min(0).max(1).safeParse(saved[positionKey])
      return {
        visible:
          session[hiddenKey] !== true &&
          linkedinExtensionPage(sender.url ?? "").kind !== "unsupported",
        position: position.success ? position.data : 0.18,
      }
    })().then(respond, () => respond({ ok: false }))
    return true
  })
  chrome.tabs.onRemoved.addListener((id) => {
    void chrome.storage.session.remove(`widget:hidden:${id}`)
  })
}
