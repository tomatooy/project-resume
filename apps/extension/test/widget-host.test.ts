import { afterEach, expect, it, vi } from "vitest"

type View = "panel" | "widget" | "none"
type Listener = (
  message: unknown,
  sender: { id?: string },
  respond: (value?: unknown) => void
) => void
const base = "chrome-extension://extension/"
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  // Orphan this test's hosts so they step aside for the next one.
  vi.stubGlobal("chrome", {})
  document.dispatchEvent(
    new CustomEvent("vs-resume-widget:probe", { cancelable: true })
  )
  Reflect.deleteProperty(document, "visibilityState")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function mount(view: View) {
  const state = { view, position: 0.25 }
  const attach = vi.spyOn(Element.prototype, "attachShadow")
  const listeners: Listener[] = []
  const runtime: { id?: string } & Record<string, unknown> = {
    id: "extension",
    getURL: (path: string) => `${base}${path}`,
    sendMessage: vi.fn(async (message: { type: string }) =>
      message.type === "widget-state" ? { ...state } : { ok: true }
    ),
    onMessage: {
      addListener: (listener: Listener) => listeners.push(listener),
      removeListener: vi.fn(),
    },
  }
  vi.stubGlobal("chrome", { runtime })
  await import("../src/content/widget-host")
  await settle()
  const host = document.getElementById("vs-resume-widget")
  const shadow = attach.mock.results.at(-1)?.value
  if (!(shadow instanceof ShadowRoot) || !host)
    throw new Error("Host not mounted")
  const frame = () => shadow.querySelector("iframe")
  return {
    state,
    runtime,
    host,
    frame,
    sendMessage: runtime.sendMessage,
    ask: (message: object) =>
      new Promise<unknown>((resolve) =>
        listeners.at(-1)?.(message, { id: "extension" }, resolve)
      ),
    post: (data: object, origin = "chrome-extension://extension") =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data,
          origin,
          source: frame()?.contentWindow,
        })
      ),
  }
}

it("pins the widget right, clamps movement, ignores other frames and closes it", async () => {
  const page = await mount("widget")
  expect(page.frame()?.src).toBe(`${base}widget.html`)
  expect(page.host.style.display).toBe("block")
  expect(page.host.style.position).toBe("fixed")
  expect(page.host.style.right).toBe("0px")
  const initial = page.host.style.top
  page.post({ type: "widget-move", delta: 100 }, "https://www.linkedin.com")
  expect(page.host.style.top).toBe(initial)
  page.post({ type: "widget-move", delta: 100000 })
  expect(page.host.style.top).toBe(`${Math.max(0, window.innerHeight - 88)}px`)
  page.post({ type: "widget-save" })
  expect(page.sendMessage).toHaveBeenCalledWith({
    type: "widget-position",
    position: 1,
  })
  page.post({ type: "widget-move", delta: -100000 })
  expect(page.host.style.top).toBe("0px")
  page.post({ type: "widget-dismiss" })
  expect(page.host.style.display).toBe("none")
  expect(page.frame()).toBeNull()
  expect(page.sendMessage).toHaveBeenCalledWith({ type: "widget-dismiss" })
  expect(await page.ask({ type: "widget-ping" })).toEqual({ view: "none" })
})

it("loads a fresh frame when the background switches the view", async () => {
  const page = await mount("widget")
  const widget = page.frame()
  page.state.view = "panel"
  expect(await page.ask({ type: "widget-refresh" })).toEqual({ ok: true })
  await settle()
  expect(page.frame()?.src).toBe(`${base}panel.html`)
  expect(widget?.isConnected).toBe(false)
  expect(page.host.style.top).toBe("0px")
  expect(page.host.style.height).toBe("100dvh")
  expect(await page.ask({ type: "widget-ping" })).toEqual({ view: "panel" })
  // The panel controls itself through the background, not the page.
  page.post({ type: "widget-dismiss" })
  expect(page.frame()?.src).toBe(`${base}panel.html`)
  page.state.view = "widget"
  await page.ask({ type: "widget-refresh" })
  await settle()
  expect(page.frame()?.src).toBe(`${base}widget.html`)
  expect(page.host.style.width).toBe("96px")
})

it("waits to load the panel until a background tab is shown", async () => {
  let visibility: DocumentVisibilityState = "hidden"
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  })
  const page = await mount("panel")
  expect(page.frame()).toBeNull()
  expect(page.host.style.display).toBe("none")
  visibility = "visible"
  document.dispatchEvent(new Event("visibilitychange"))
  await settle()
  expect(page.frame()?.src).toBe(`${base}panel.html`)
  visibility = "hidden"
  page.state.view = "widget"
  await page.ask({ type: "widget-refresh" })
  await settle()
  expect(page.frame()?.src).toBe(`${base}widget.html`)
})

it("keeps one live host and replaces one left behind by an older install", async () => {
  const page = await mount("widget")
  vi.resetModules()
  await import("../src/content/widget-host")
  expect(document.querySelectorAll("#vs-resume-widget")).toHaveLength(1)
  expect(document.getElementById("vs-resume-widget")).toBe(page.host)
  // Reloading the extension invalidates the old host's runtime.
  page.runtime.id = undefined
  vi.resetModules()
  await import("../src/content/widget-host")
  await settle()
  expect(page.host.isConnected).toBe(false)
  expect(document.querySelectorAll("#vs-resume-widget")).toHaveLength(1)
})

it("removes itself when the extension goes away", async () => {
  const page = await mount("widget")
  page.runtime.id = undefined
  document.dispatchEvent(new Event("visibilitychange"))
  expect(page.host.isConnected).toBe(false)
})
