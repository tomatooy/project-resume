// The build keeps this classic content script self-contained.
;(() => {
  function destination(href: string): string | null {
    try {
      let url = new URL(href, "https://www.linkedin.com")
      const linkedin = () =>
        url.hostname === "linkedin.com" ||
        url.hostname.endsWith(".linkedin.com")
      if (linkedin() && /^\/safety\/go\/?$/.test(url.pathname)) {
        const targets = url.searchParams.getAll("url")
        if (targets.length !== 1 || !targets[0]) return null
        url = new URL(targets[0])
      }
      if (
        linkedin() ||
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.href.length > 4_000
      )
        return null
      return url.href
    } catch {
      return null
    }
  }

  function available(anchor: HTMLAnchorElement, jobId: string): boolean {
    for (let node: Element | null = anchor; node; node = node.parentElement) {
      if (
        node.hasAttribute("hidden") ||
        node.hasAttribute("inert") ||
        node.getAttribute("aria-hidden") === "true" ||
        node.getAttribute("aria-disabled") === "true"
      )
        return false
      const scopedJob = node.getAttribute("data-job-id")
      if (scopedJob && scopedJob !== jobId) return false
      const style = anchor.ownerDocument.defaultView?.getComputedStyle(node)
      if (style?.display === "none" || style?.visibility === "hidden")
        return false
    }
    return true
  }

  function captureApplyLink(
    document: Document,
    jobId: string
  ): { sourceUrl: string; applyUrl: string | null } {
    const candidates = new Map<string, number>()
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>(
      "a[href]"
    )) {
      const label = (
        anchor.getAttribute("aria-label") ||
        anchor.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
      const tracking = anchor.getAttribute("data-tracking-control-name") ?? ""
      const explicit =
        /apply (?:directly )?on (?:the )?company website/.test(label) ||
        tracking.endsWith("apply-link-offsite")
      if ((!explicit && label !== "apply") || !available(anchor, jobId))
        continue
      const url = destination(anchor.getAttribute("href") ?? "")
      if (url)
        candidates.set(
          url,
          Math.max(candidates.get(url) ?? 0, explicit ? 2 : 1)
        )
    }
    const best = Math.max(0, ...candidates.values())
    const matches = [...candidates].filter(([, priority]) => priority === best)
    return {
      sourceUrl: document.location.href,
      applyUrl: matches.length === 1 ? (matches[0]?.[0] ?? null) : null,
    }
  }
  if (document.getElementById("vs-resume-widget")) return
  const host = document.createElement("div")
  host.id = "vs-resume-widget"
  const shadow = host.attachShadow({ mode: "closed" })
  const frame = document.createElement("iframe")
  frame.src = chrome.runtime.getURL("widget.html")
  const extensionOrigin = chrome.runtime.getURL("").replace(/\/$/, "")
  frame.title = "VS:Résumé"
  frame.style.cssText =
    "display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:light;"
  shadow.append(frame)
  host.style.cssText =
    "all:initial;position:fixed;right:0;top:120px;width:96px;height:88px;z-index:2147483647;display:none;"
  document.documentElement.append(host)
  let position = 0.18
  let expanded = false
  let generation = 0
  const room = () => Math.max(0, window.innerHeight - 88)
  const layout = () => {
    host.style.top = expanded ? "0px" : `${Math.round(position * room())}px`
    host.style.width = expanded ? "min(400px, 100vw)" : "96px"
    host.style.height = expanded ? "100dvh" : "88px"
  }
  const setExpanded = (next: boolean) => {
    if (expanded === next) return
    generation += 1
    expanded = next
    frame.src = chrome.runtime.getURL(next ? "panel.html" : "widget.html")
    host.style.display = "block"
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
        !("visible" in state) ||
        !("position" in state) ||
        typeof state.position !== "number" ||
        !Number.isFinite(state.position)
      )
        return
      position = Math.max(0, Math.min(1, state.position))
      layout()
      host.style.display = expanded || state.visible === true ? "block" : "none"
    } catch {
      host.style.display = "none"
    }
  }
  const persist = () => {
    void send({ type: "widget-position", position }).catch(() => {})
  }
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (
      event.source !== frame.contentWindow ||
      event.origin !== extensionOrigin
    )
      return
    const data = event.data
    if (typeof data !== "object" || data === null || !("type" in data)) return
    if (data.type === "panel-collapse" && expanded) {
      setExpanded(false)
      return
    }
    if (expanded) return
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
    } else if (data.type === "widget-save") persist()
    else if (data.type === "widget-dismiss") {
      generation += 1
      host.style.display = "none"
      void send({ type: "widget-dismiss" }).catch(() => {})
    }
  })
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (
      sender.id === chrome.runtime.id &&
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      typeof message.type === "string"
    ) {
      if (message.type === "widget-refresh") void refresh()
      else if (message.type === "panel-open") {
        setExpanded(true)
        respond({ ok: true })
      } else if (
        message.type === "capture-apply-link" &&
        "jobId" in message &&
        typeof message.jobId === "string" &&
        /^\d{6,}$/.test(message.jobId)
      ) {
        respond(captureApplyLink(document, message.jobId))
      }
    }
  })
  window.addEventListener("resize", layout)
  void refresh()
})()

export {}
