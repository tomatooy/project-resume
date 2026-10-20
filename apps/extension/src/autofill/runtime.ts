import type {
  ContentMessage,
  WorkerMessage,
  WorkerReply,
} from "../lib/autofill-protocol"
import type { PageInfo, VendorAdapter } from "./types"

const PROBE = "vs-resume-autofill:probe"
const NO_PAGE: PageInfo = { company: null, companyWeak: false, title: null }

type Scan = Extract<ContentMessage, { type: "autofill-scan" }>

const WORKER_TYPES = new Set<string>([
  "autofill-ping",
  "autofill-rescan",
  "autofill-read-options",
  "autofill-write",
  "autofill-attach",
  "autofill-clear",
  "autofill-focus",
  "autofill-overlay",
  "autofill-draft-result",
] satisfies WorkerMessage["type"][])

/**
 * Only this extension reaches the listener (checked by sender id) and it sends
 * `WorkerMessage` values, so the type routes them. The widget host's messages
 * reach the same tab and are left alone.
 */
function isWorkerMessage(value: unknown): value is WorkerMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    WORKER_TYPES.has(value.type)
  )
}

function alive(): boolean {
  try {
    return Boolean(chrome.runtime?.id)
  } catch {
    return false
  }
}

const send = async (message: ContentMessage): Promise<unknown> =>
  chrome.runtime.sendMessage(message)

/**
 * Runs autofill on the page: reports the form and its fields to the service
 * worker as they change, and answers its messages. Null when a live copy
 * already runs.
 */
export function startAutofill(
  adapter: VendorAdapter | null,
  options: { debounceMs?: number } = {}
): { stop(): void } | null {
  // A live copy cancels the probe. A copy from an older install stops instead,
  // so the newest one always wins.
  if (!document.dispatchEvent(new CustomEvent(PROBE, { cancelable: true })))
    return null
  const debounceMs = options.debounceMs ?? 300
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = ""

  const postingKey = (url: URL): string | null =>
    adapter?.postingKey(url) ?? null

  // Without a posting key the service worker cannot key a plan, so the page
  // reports no form.
  const read = (): Scan => {
    const url = new URL(location.href)
    const key = postingKey(url)
    const form = adapter && key !== null ? adapter.findForm(document) : null
    return {
      type: "autofill-scan",
      url: location.origin + location.pathname,
      postingKey: key,
      page: adapter ? adapter.page(document, url) : NO_PAGE,
      form: form !== null,
      formLink: adapter && !form ? adapter.formLink(document, url) : null,
      fields:
        adapter && form
          ? adapter.scan(form).map((field) => field.descriptor)
          : [],
    }
  }

  const scan = (force: boolean) => {
    clearTimeout(timer)
    timer = undefined
    const message = read()
    const sent = JSON.stringify(message)
    if (!force && sent === last) return
    last = sent
    send(message).catch(() => {
      if (!alive()) stop()
      // Sent again on the next change.
      else if (last === sent) last = ""
    })
  }

  // The first change starts the wait, so a page that never stops changing
  // still gets scanned.
  const schedule = () => {
    timer ??= setTimeout(() => scan(false), debounceMs)
  }

  const onRuntime = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (response?: unknown) => void
  ): boolean => {
    if (sender.id !== chrome.runtime.id || !isWorkerMessage(message))
      return false
    switch (message.type) {
      case "autofill-ping": {
        const reply: WorkerReply<"autofill-ping"> = {
          alive: true,
          postingKey: postingKey(new URL(location.href)),
        }
        respond(reply)
        return false
      }
      case "autofill-rescan": {
        const reply: WorkerReply<"autofill-rescan"> = { ok: true }
        respond(reply)
        scan(true)
        return false
      }
      default:
        return false
    }
  }

  const onProbe = (event: Event) => {
    if (alive()) event.preventDefault()
    else stop()
  }

  const observer = new MutationObserver(schedule)

  const stop = () => {
    clearTimeout(timer)
    timer = undefined
    observer.disconnect()
    document.removeEventListener("input", schedule, true)
    document.removeEventListener("change", schedule, true)
    document.removeEventListener(PROBE, onProbe)
    try {
      chrome.runtime.onMessage.removeListener(onRuntime)
    } catch {
      /* The extension context is already gone. */
    }
  }

  observer.observe(document.body ?? document.documentElement, {
    childList: true,
    subtree: true,
  })
  document.addEventListener("input", schedule, true)
  document.addEventListener("change", schedule, true)
  document.addEventListener(PROBE, onProbe)
  chrome.runtime.onMessage.addListener(onRuntime)
  scan(true)
  return { stop }
}
