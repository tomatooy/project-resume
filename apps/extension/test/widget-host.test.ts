import { afterEach, expect, it, vi } from "vitest"

afterEach(() => {
  document.getElementById("vs-resume-widget")?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
})
it("pins to the right, clamps movement, ignores other frames and hides on dismissal", async () => {
  const attach = vi.spyOn(Element.prototype, "attachShadow")
  const sendMessage = vi.fn(async () => ({ visible: true, position: 0.25 }))
  const listener = vi.fn<typeof chrome.runtime.onMessage.addListener>()
  vi.stubGlobal("chrome", {
    runtime: {
      id: "extension",
      getURL: (path: string) => `chrome-extension://extension/${path}`,
      sendMessage,
      onMessage: { addListener: listener },
    },
  })
  await import("../src/content/widget-host")
  const host = document.getElementById("vs-resume-widget")
  const shadow = attach.mock.results[0]?.value
  if (!(shadow instanceof ShadowRoot) || !host)
    throw new Error("Widget not mounted")
  const frame = shadow.querySelector("iframe")
  if (!frame) throw new Error("Widget frame missing")
  const move = (data: object, origin = "chrome-extension://extension") =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data,
        origin,
        source: frame.contentWindow,
      })
    )
  await vi.waitFor(() => expect(host.style.display).toBe("block"))
  expect(host.style.position).toBe("fixed")
  expect(host.style.right).toBe("0px")
  const initial = host.style.top
  move({ type: "widget-move", delta: 100 }, "https://www.linkedin.com")
  expect(host.style.top).toBe(initial)
  move({ type: "widget-move", delta: 100000 })
  expect(host.style.top).toBe(`${Math.max(0, window.innerHeight - 88)}px`)
  move({ type: "widget-save" })
  expect(sendMessage).toHaveBeenCalledWith({
    type: "widget-position",
    position: 1,
  })
  move({ type: "widget-move", delta: -100000 })
  expect(host.style.top).toBe("0px")
  move({ type: "widget-dismiss" })
  expect(host.style.display).toBe("none")
  expect(sendMessage).toHaveBeenCalledWith({ type: "widget-dismiss" })
  listener.mock.calls[0]?.[0](
    { type: "panel-open" },
    { id: "extension" },
    vi.fn()
  )
  expect(host.style.display).toBe("block")
  expect(host.style.top).toBe("0px")
  expect(host.style.height).toBe("100dvh")
  expect(frame.src).toBe("chrome-extension://extension/panel.html")
  move({ type: "panel-collapse" })
  expect(frame.src).toBe("chrome-extension://extension/widget.html")
  expect(host.style.width).toBe("96px")
  expect(host.style.display).toBe("block")
})
