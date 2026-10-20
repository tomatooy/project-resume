import type { Option } from "@workspace/autofill/fields"
import type {
  ContentMessage,
  WorkerMessage,
  WorkerReply,
} from "../lib/autofill-protocol"
import { LIMITS } from "./dom"
import { handleFor } from "./drivers"
import { createOwner } from "./owner"
import type {
  FieldHandle,
  PageInfo,
  ScannedField,
  VendorAdapter,
} from "./types"
import { writeAll } from "./writer"

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

/** The innermost scanned field holding `target`, else null. */
function fieldAt(
  fields: readonly ScannedField[],
  target: EventTarget | null
): ScannedField | null {
  if (!(target instanceof Node)) return null
  const exact = fields.find(
    ({ element, choices }) =>
      element === target || choices.some((choice) => choice.element === target)
  )
  if (exact) return exact
  let inner: ScannedField | null = null
  for (const field of fields)
    if (
      field.element.contains(target) &&
      (!inner || inner.element.contains(field.element))
    )
      inner = field
  return inner
}

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
  let fields: ScannedField[] = []
  let handles = new Map<string, FieldHandle>()
  let watched: { form: Element; unwatch: () => void } | null = null
  // Requests run one at a time, and scans wait until none is left.
  let queue: Promise<unknown> = Promise.resolve()
  let queued = 0
  let held = false

  const post = (message: ContentMessage): Promise<boolean> =>
    send(message).then(
      () => true,
      () => {
        if (!alive()) stop()
        return false
      }
    )

  const owner = createOwner({
    debounceMs,
    report: (fieldIds) => {
      for (let i = 0; i < fieldIds.length; i += LIMITS.fields)
        void post({
          type: "autofill-owned",
          fieldIds: fieldIds.slice(i, i + LIMITS.fields),
        })
    },
  })

  const postingKey = (url: URL): string | null =>
    adapter?.postingKey(url) ?? null

  // Without a posting key the service worker cannot key a plan, so the page
  // reports no form. Each read also refreshes the handles requests use.
  const read = (): Scan => {
    const url = new URL(location.href)
    const key = postingKey(url)
    const form = adapter && key !== null ? adapter.findForm(document) : null
    fields = adapter && form ? adapter.scan(form) : []
    handles = new Map(
      fields.map((field) => [field.descriptor.id, handleFor(field)])
    )
    owner.noteScan(
      fields.map(({ descriptor }) => ({
        id: descriptor.id,
        hasValue: descriptor.hasValue,
      }))
    )
    if ((watched?.form ?? null) !== form) {
      watched?.unwatch()
      watched = form
        ? {
            form,
            unwatch: owner.watch(
              form,
              (target) => fieldAt(fields, target)?.descriptor.id ?? null
            ),
          }
        : null
    }
    return {
      type: "autofill-scan",
      url: location.origin + location.pathname,
      postingKey: key,
      page: adapter ? adapter.page(document, url) : NO_PAGE,
      form: form !== null,
      formLink: adapter && !form ? adapter.formLink(document, url) : null,
      fields: fields.map((field) => field.descriptor),
    }
  }

  const scan = (force: boolean) => {
    clearTimeout(timer)
    timer = undefined
    // Our own writes would report half-filled forms; one scan follows them.
    if (queued > 0) {
      held = true
      return
    }
    const message = read()
    const sent = JSON.stringify(message)
    if (!force && sent === last) return
    last = sent
    void post(message).then((ok) => {
      // Sent again on the next change.
      if (!ok && last === sent) last = ""
    })
  }

  // The first change starts the wait, so a page that never stops changing
  // still gets scanned.
  const schedule = () => {
    timer ??= setTimeout(() => scan(false), debounceMs)
  }

  /** Runs `task` after the requests before it, on fresh handles. */
  const request = <T>(task: () => Promise<T>): Promise<T> => {
    queued += 1
    const run = queue.then(async () => {
      try {
        read()
        return await task()
      } finally {
        queued -= 1
        if (queued === 0 && held) {
          held = false
          scan(true)
        }
      }
    })
    queue = run.catch(() => undefined)
    return run
  }

  const readOptions = async (
    fieldIds: string[]
  ): Promise<WorkerReply<"autofill-read-options">> => {
    // One widget at a time: each opens its menu, reads it and closes it.
    const entries: [string, Option[] | null][] = []
    for (const id of fieldIds) {
      const handle = handles.get(id)
      const listed = handle
        ? await handle.readOptions().catch(() => null)
        : null
      entries.push([id, listed])
    }
    return { options: Object.fromEntries(entries) }
  }

  const clear = async (
    fieldId: string
  ): Promise<WorkerReply<"autofill-clear">> => {
    const handle = handles.get(fieldId)
    try {
      await handle?.clear()
    } finally {
      // The user asked for it empty, so it stays theirs.
      owner.own([fieldId])
    }
    return { ok: handle !== undefined }
  }

  const focus = (fieldId: string): Promise<WorkerReply<"autofill-focus">> => {
    const handle = handles.get(fieldId)
    handle?.focus()
    return Promise.resolve({ ok: handle !== undefined })
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
      case "autofill-read-options": {
        const failed: WorkerReply<"autofill-read-options"> = { options: {} }
        void request(() => readOptions(message.fieldIds)).then(respond, () =>
          respond(failed)
        )
        return true
      }
      case "autofill-write": {
        const { fills, force } = message
        const failed: WorkerReply<"autofill-write"> = { results: {} }
        void request(
          async (): Promise<WorkerReply<"autofill-write">> => ({
            results: await writeAll(handles, fills, new Set(force), owner),
          })
        ).then(respond, () => respond(failed))
        return true
      }
      case "autofill-clear": {
        const failed: WorkerReply<"autofill-clear"> = { ok: false }
        void request(() => clear(message.fieldId)).then(respond, () =>
          respond(failed)
        )
        return true
      }
      case "autofill-focus": {
        const failed: WorkerReply<"autofill-focus"> = { ok: false }
        void request(() => focus(message.fieldId)).then(respond, () =>
          respond(failed)
        )
        return true
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
    watched?.unwatch()
    watched = null
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
