import { ContentCommandSchema, PROTOCOL } from "./messages"
import { Registry, committed, previewValue } from "./registry"
import { Scanner } from "./scanner"
import { Executor } from "./executor"
import { isAutofillApplicationUrl } from "./sites"

let instanceId = ""
let registry: Registry | null = null
let scanner: Scanner | null = null
let executor: Executor | null = null
let host: HTMLElement | null = null
let busy = false
chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return false
  const parsed = ContentCommandSchema.safeParse(raw)
  if (!parsed.success) return false
  const command = parsed.data
  if (command.type === "af.hello") {
    respond({ protocolVersion: PROTOCOL, instanceId })
    return false
  }
  if (command.type === "af.bootstrap") {
    executor?.cancel(Number.MAX_SAFE_INTEGER)
    registry?.release()
    host?.remove()
    instanceId = command.instanceId
    registry = new Registry(document)
    registry.documentEpoch = command.documentEpoch
    scanner = new Scanner(registry)
    executor = new Executor(registry, command.documentId)
    registry.onIntervention = () => {
      executor?.cancel(executor.generation)
      void chrome.runtime
        .sendMessage({
          type: "af.userIntervened",
          protocolVersion: PROTOCOL,
          instanceId,
          sessionId: executor?.sessionId,
          generation: executor?.generation,
        })
        .catch(() => undefined)
    }
    if (command.panelNonce) {
      host = document.createElement("div")
      host.dataset.vsAutofill = "true"
      host.style.cssText =
        "all:initial;position:fixed;right:0;top:0;width:min(420px,100vw);height:100dvh;z-index:2147483647;"
      const shadow = host.attachShadow({ mode: "closed" })
      const frame = document.createElement("iframe")
      frame.title = "VS:Résumé autofill"
      frame.src = chrome.runtime.getURL(
        `panel.html#autofill=${command.panelNonce}`
      )
      frame.style.cssText =
        "display:block;width:100%;height:100%;border:0;background:white;"
      shadow.append(frame)
      document.documentElement.append(host)
    }
    respond({ ok: true, instanceId })
    return false
  }
  if (!executor || !scanner || command.instanceId !== instanceId) return false
  if (command.type === "af.cancel" || command.type === "af.release") {
    executor.cancel(command.generation)
    if (command.type === "af.release") {
      host?.remove()
      registry?.release()
    }
    respond({
      ok: true,
      generation: command.generation,
      requestId: command.requestId,
    })
    return false
  }
  const currentExecutor = executor
  const currentScanner = scanner
  if (busy) {
    respond({ ok: false, reason: "step_in_flight" })
    return false
  }
  busy = true
  void (async () => {
    if (command.type === "af.observe") {
      currentExecutor.authorize(command.sessionId, command.generation)
      return {
        ok: true,
        requestId: command.requestId,
        generation: command.generation,
        observation: currentScanner.observe(
          command.formId,
          command.contextRequests
        ),
      }
    }
    if (
      command.sessionId !== currentExecutor.sessionId ||
      command.generation !== currentExecutor.generation
    )
      throw new Error("stale_generation")
    if (command.type === "af.preview") {
      const entry = registry?.entries.get(command.fieldId)
      if (!entry?.element.isConnected || entry.before !== committed(entry))
        throw new Error("Field changed")
      return {
        ok: true,
        requestId: command.requestId,
        generation: command.generation,
        preview: {
          fieldId: entry.id,
          fieldRevision: entry.revision,
          guardRef: entry.guard,
          value: previewValue(entry).slice(0, 4000),
        },
      }
    }
    if (command.type === "af.audit") {
      return {
        ok: true,
        requestId: command.requestId,
        generation: command.generation,
        results: currentExecutor.audit(),
      }
    }
    if (command.type === "af.discover") {
      await currentExecutor.discover(command.plan, command.interaction)
      return {
        ok: true,
        requestId: command.requestId,
        generation: command.generation,
      }
    }
    if (command.type === "af.addRecord") {
      return {
        ok: true,
        requestId: command.requestId,
        generation: command.generation,
        ...(await currentExecutor.addRecord(
          command.entryRef,
          command.entryRevision,
          command.kind
        )),
      }
    }
    const replacement = command.replacement
    const allowReplace = Boolean(
      replacement?.confirmed &&
        replacement.replace &&
        replacement.fieldId === command.action.fieldId &&
        replacement.guardRef === command.action.guardRef &&
        replacement.fieldRevision === command.action.fieldRevision
    )
    return {
      ok: true,
      requestId: command.requestId,
      generation: command.generation,
      result: await currentExecutor.execute(
        command.plan,
        command.action,
        command.policy,
        allowReplace,
        command.file
      ),
    }
  })()
    .then(respond, () => respond({ ok: false, reason: "step_unavailable" }))
    .finally(() => {
      busy = false
    })
  return true
})

// Page lifecycle events invalidate even when the worker is asleep.
addEventListener("pagehide", () => executor?.cancel(Number.MAX_SAFE_INTEGER))
addEventListener("popstate", () => {
  if (registry) registry.documentEpoch++
  executor?.cancel(executor.generation)
})
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible")
    executor?.cancel(executor.generation)
})

if (window === window.top && isAutofillApplicationUrl(location.href))
  void chrome.runtime
    .sendMessage({ type: "af.ready", protocolVersion: PROTOCOL })
    .catch(() => undefined)
