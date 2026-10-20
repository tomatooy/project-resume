// A classic content-script entry, kept free of module imports by the build.
;(() => {
  type View = "panel" | "widget" | "none"
  const probe = "vs-resume-widget:probe"
  // A live host cancels the probe. Orphans from an older install remove
  // themselves instead, so the newest host always wins.
  if (!document.dispatchEvent(new CustomEvent(probe, { cancelable: true })))
    return
  document.getElementById("vs-resume-widget")?.remove()
  const host = document.createElement("div")
  host.id = "vs-resume-widget"
  const shadow = host.attachShadow({ mode: "closed" })
  host.style.cssText =
    "all:initial;position:fixed;right:0;top:120px;width:96px;height:88px;z-index:2147483647;display:none;"
  document.documentElement.append(host)
  const extensionOrigin = chrome.runtime.getURL("").replace(/\/$/, "")
  let frame: HTMLIFrameElement | null = null
  let shown: View = "none"
  let wanted: View = "none"
  let position = 0.18
  let generation = 0
  let watchedOrigin: string | null = null
  let frameVisible: boolean | null = null
  let frameTimer: ReturnType<typeof setTimeout> | undefined
  const alive = () => {
    try {
      return Boolean(chrome.runtime?.id)
    } catch {
      return false
    }
  }
  const isView = (value: unknown): value is View =>
    value === "panel" || value === "widget" || value === "none"
  const room = () => Math.max(0, window.innerHeight - 88)
  const layout = () => {
    const panel = shown === "panel"
    host.style.display = shown === "none" ? "none" : "block"
    host.style.top = panel ? "0px" : `${Math.round(position * room())}px`
    host.style.width = panel ? "min(400px, 100vw)" : "96px"
    host.style.height = panel ? "100dvh" : "88px"
  }
  const render = () => {
    // Background tabs wait to load the panel until they are first shown.
    const next =
      wanted === "panel" &&
      shown !== "panel" &&
      document.visibilityState !== "visible"
        ? shown
        : wanted
    if (next !== shown) {
      // A new element, because changing src adds entries to the page history.
      frame?.remove()
      frame = null
      if (next !== "none") {
        frame = document.createElement("iframe")
        frame.src = chrome.runtime.getURL(
          next === "panel" ? "panel.html" : "widget.html"
        )
        frame.title = "VS:Résumé"
        frame.style.cssText =
          "display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:light;"
        shadow.append(frame)
      }
      shown = next
    }
    layout()
  }
  const send = async (message: object): Promise<unknown> =>
    chrome.runtime.sendMessage(message)
  const refresh = async () => {
    const current = ++generation
    try {
      const state = await send({ type: "widget-state" })
      if (
        current !== generation ||
        typeof state !== "object" ||
        state === null ||
        !("view" in state) ||
        !("position" in state) ||
        !isView(state.view) ||
        typeof state.position !== "number" ||
        !Number.isFinite(state.position)
      )
        return
      position = Math.max(0, Math.min(1, state.position))
      wanted = state.view
      render()
    } catch {
      if (!alive()) teardown()
    }
  }
  const forward = (message: object) => {
    void send(message).catch(() => {
      if (!alive()) teardown()
    })
  }
  const embeddedVisibility = (origin: string): boolean | null => {
    const matches = [...document.querySelectorAll("iframe")].filter((node) => {
      try {
        return new URL(node.src).origin === origin
      } catch {
        return false
      }
    })
    // An origin alone cannot identify one of several sibling embeds.
    const [embedded] = matches
    if (matches.length !== 1 || !embedded) return null
    return (
      embedded.getClientRects().length > 0 &&
      getComputedStyle(embedded).visibility !== "hidden"
    )
  }
  const inspectFrames = () => {
    if (!watchedOrigin || frameTimer) return
    frameTimer = setTimeout(() => {
      frameTimer = undefined
      if (!watchedOrigin) return
      const next = embeddedVisibility(watchedOrigin)
      if (next === frameVisible) return
      frameVisible = next
      forward({ type: "autofill-frame-change" })
    }, 300)
  }
  const frameObserver = new MutationObserver(inspectFrames)
  const onMessage = (event: MessageEvent<unknown>) => {
    if (
      shown !== "widget" ||
      event.source !== frame?.contentWindow ||
      event.origin !== extensionOrigin
    )
      return
    const data = event.data
    if (typeof data !== "object" || data === null || !("type" in data)) return
    if (
      data.type === "widget-move" &&
      "delta" in data &&
      typeof data.delta === "number" &&
      Number.isFinite(data.delta)
    ) {
      generation += 1
      position = room()
        ? Math.max(0, Math.min(1, position + data.delta / room()))
        : 0
      layout()
    } else if (data.type === "widget-save")
      forward({ type: "widget-position", position })
    else if (data.type === "widget-dismiss") {
      generation += 1
      wanted = "none"
      render()
      forward({ type: "widget-dismiss" })
    }
  }
  const onRuntime = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (response?: unknown) => void
  ) => {
    if (
      sender.id !== chrome.runtime.id ||
      typeof message !== "object" ||
      message === null ||
      !("type" in message)
    )
      return
    if (message.type === "widget-ping") respond({ view: shown })
    else if (
      message.type === "autofill-frame-state" &&
      "origin" in message &&
      typeof message.origin === "string"
    ) {
      watchedOrigin = message.origin
      frameVisible = embeddedVisibility(watchedOrigin)
      respond({ visible: frameVisible })
    } else if (message.type === "widget-refresh") {
      respond({ ok: true })
      void refresh()
    }
  }
  const onVisibility = () => {
    if (!alive()) teardown()
    else if (document.visibilityState === "visible") void refresh()
  }
  const onShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return
    if (!alive()) teardown()
    else void refresh()
  }
  const onProbe = (event: Event) => {
    if (alive()) event.preventDefault()
    else teardown()
  }
  const teardown = () => {
    generation += 1
    clearTimeout(frameTimer)
    frameObserver.disconnect()
    host.remove()
    window.removeEventListener("message", onMessage)
    window.removeEventListener("resize", layout)
    window.removeEventListener("resize", inspectFrames)
    window.removeEventListener("pageshow", onShow)
    document.removeEventListener("visibilitychange", onVisibility)
    document.removeEventListener(probe, onProbe)
    try {
      chrome.runtime.onMessage.removeListener(onRuntime)
    } catch {
      /* The extension context is already gone. */
    }
  }
  window.addEventListener("message", onMessage)
  window.addEventListener("resize", layout)
  window.addEventListener("resize", inspectFrames)
  window.addEventListener("pageshow", onShow)
  document.addEventListener("visibilitychange", onVisibility)
  document.addEventListener(probe, onProbe)
  chrome.runtime.onMessage.addListener(onRuntime)
  frameObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "style", "class", "hidden"],
  })
  void refresh()
})()

export {}
