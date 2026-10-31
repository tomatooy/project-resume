import type {
  ContentMessage,
  WorkerMessage,
  WorkerReply,
} from "../lib/autofill-protocol"
import type { ResolveSearch } from "./types"
import { fieldRow, trace, traceTable } from "./debug"
import { createDiscovery } from "./discovery"
import { isShown, LIMITS, scriptClick } from "./dom"
import { handleFor } from "./drivers"
import { fieldIdentity } from "./field-identity"
import { type AttachResult, attachFile } from "./file"
import { createOverlay } from "./overlay"
import { createOwner } from "./owner"
import { scanUrl } from "./posting-url"
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
type Attach = Extract<WorkerMessage, { type: "autofill-attach" }>

const WORKER_TYPES = new Set<string>([
  "autofill-ping",
  "autofill-rescan",
  "autofill-open-form",
  "autofill-prepare",
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
  options: {
    debounceMs?: number
    /** Replaces the `DataTransfer` attach, which jsdom lacks. */
    setFiles?: (input: HTMLInputElement, file: File) => void
  } = {}
): { stop(): void } | null {
  // A live copy cancels the probe. A copy from an older install stops instead,
  // so the newest one always wins.
  if (!document.dispatchEvent(new CustomEvent(PROBE, { cancelable: true })))
    return null
  const debounceMs = options.debounceMs ?? 300
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = ""
  let fingerprint = ""
  let revision = 0
  const discovery = createDiscovery()
  let fields: ScannedField[] = []
  let handles = new Map<string, FieldHandle>()
  let watched: { root: Element; unwatch: () => void } | null = null
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

  const labelOf = (id: string): string =>
    fields.find(({ descriptor }) => descriptor.id === id)?.descriptor.label ??
    id

  const owner = createOwner({
    debounceMs,
    report: (fieldIds) => {
      discovery.invalidate()
      trace(
        "you changed these fields, so autofill leaves them alone:",
        fieldIds.map(labelOf)
      )
      for (let i = 0; i < fieldIds.length; i += LIMITS.fields)
        void post({
          type: "autofill-owned",
          fieldIds: fieldIds.slice(i, i + LIMITS.fields),
        })
    },
  })

  // Write with AI drafts go only into text inputs and textareas.
  const overlay = createOverlay({
    send: (message) => void post(message),
    field: (fieldId) => {
      const found = fields.find(({ descriptor }) => descriptor.id === fieldId)
      const element = found?.kind === "text" ? found.element : undefined
      return element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
        ? element
        : undefined
    },
    owner,
  })

  const postingKey = (url: URL): string | null =>
    adapter?.postingKey(url) ?? null

  // Without a posting key the service worker cannot key a plan, so the page
  // reports no form. Each read also refreshes the handles requests use.
  const read = (): Scan => {
    const url = new URL(location.href)
    const key = postingKey(url)
    const root = adapter && key !== null ? document.body : null
    fields = discovery.enrich(
      adapter && root ? adapter.scan(root) : [],
      scanUrl(url.href)
    )
    handles = new Map(
      fields.map((field) => [field.descriptor.id, handleFor(field)])
    )
    owner.noteScan(
      fields.map(({ descriptor }) => ({
        id: descriptor.id,
        hasValue: descriptor.hasValue,
      }))
    )
    if ((watched?.root ?? null) !== root) {
      watched?.unwatch()
      watched = root
        ? {
            root,
            unwatch: owner.watch(root, (event) => {
              const field = fieldAt(fields, event.target)
              if (!field) return null
              if (event.type !== "click") {
                discovery.invalidate()
                return field.descriptor.id
              }
              // Yes and No buttons fire no `input` or `change`, so a click on
              // one is the person's edit. Other clicks only focus or open.
              const { target } = event
              const edited =
                field.kind === "buttons" &&
                target instanceof Node &&
                field.choices.some(({ element }) => element.contains(target))
              if (edited) discovery.invalidate()
              return edited ? field.descriptor.id : null
            }),
          }
        : null
    }
    // Fields move and re-render, so the buttons follow each read.
    overlay.layout()
    const snapshot: Scan = {
      type: "autofill-scan",
      url: scanUrl(url.href),
      postingKey: key,
      page: adapter ? adapter.page(document, url) : NO_PAGE,
      form: fields.length > 0,
      formLink:
        adapter && fields.length === 0 ? adapter.formLink(document, url) : null,
      fields: fields.map((field) => field.descriptor),
    }
    const next = JSON.stringify(snapshot)
    if (next !== fingerprint) {
      fingerprint = next
      revision = Math.max(
        revision + 1,
        Math.floor((performance.timeOrigin + performance.now()) * 1000)
      )
    }
    return { ...snapshot, revision }
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
    traceTable(
      `1. scan sent to the worker: ${message.fields.length} fields, form ${message.form ? "found" : "not found"}`,
      message.fields.map(fieldRow)
    )
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
  const request = <T>(
    expectedKey: string | null | undefined,
    task: () => Promise<T>
  ): Promise<T> => {
    queued += 1
    const run = queue.then(async () => {
      try {
        const current = read()
        if (expectedKey !== undefined && current.postingKey !== expectedKey)
          throw new Error("The application changed.")
        return await task()
      } finally {
        queued -= 1
        if (queued === 0 && held) {
          held = false
          scan(false)
        }
      }
    })
    queue = run.catch(() => undefined)
    return run
  }

  const prepareFields = async (
    retry: boolean
  ): Promise<WorkerReply<"autofill-prepare">> => {
    const url = scanUrl(location.href)
    const current = () => scanUrl(location.href) === url
    const outcomes = await discovery.prepareFields(
      () => {
        read()
        return fields
      },
      owner,
      retry,
      current
    )
    if (!current()) return { scan: null, outcomes }
    const snapshot = read()
    // The response carries this scan; menu mutations must not publish it again.
    last = JSON.stringify(snapshot)
    return { scan: snapshot, outcomes }
  }

  const clear = async (
    fieldId: string
  ): Promise<WorkerReply<"autofill-clear">> => {
    const handle = handles.get(fieldId)
    try {
      await handle?.clear()
    } finally {
      discovery.invalidate()
      // The user asked for it empty, so it stays theirs.
      owner.own([fieldId])
    }
    return { ok: handle !== undefined }
  }

  const attachedName = adapter?.attachedName?.bind(adapter)
  // The names of the files each file field was given on this page.
  const placed = new Map<string, Set<string>>()

  /**
   * Attaches the resume PDF. A file it put in place stays ours even when the
   * page has not shown it yet, so a later scan never takes it for the
   * user's. Scans wait for this request, so the mark still comes first.
   */
  const attach = async ({
    fieldId,
    fileName,
    base64,
    previous,
  }: Attach): Promise<WorkerReply<"autofill-attach">> => {
    const field = fields.find(({ descriptor }) => descriptor.id === fieldId)
    if (!field) return { result: "failed" }
    if (owner.isOwned(fieldId)) return { result: "skipped" }
    const names = placed.get(fieldId) ?? new Set<string>()
    const result = await attachFile(
      field,
      { name: fileName, base64, previous },
      { setFiles: options.setFiles, attachedName, placed: names }
    ).catch((): AttachResult => "failed")
    if (result !== "skipped") {
      owner.markOurs(fieldId)
      names.add(fileName)
      placed.set(fieldId, names)
    }
    return { result }
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
    const perform = <T>(task: () => Promise<T>) =>
      request(message.postingKey, task)
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
      case "autofill-open-form": {
        void perform(async () => {
          const url = new URL(location.href)
          const link = adapter?.formLink(document, url)
          if (!link) return { ok: false }
          const target = new URL(link)
          if (target.origin !== url.origin) return { ok: false }
          const anchor = [
            ...document.querySelectorAll<HTMLAnchorElement>("a[href]"),
          ].find((node) => {
            const href = new URL(node.href)
            return (
              href.origin === target.origin &&
              href.pathname === target.pathname &&
              (node.target === "" || node.target === "_self") &&
              isShown(node)
            )
          })
          if (anchor) scriptClick(anchor)
          else {
            target.search = url.search
            location.assign(target.href)
          }
          return { ok: true }
        }).then(respond, () => respond({ ok: false }))
        return true
      }
      case "autofill-prepare": {
        const failed: WorkerReply<"autofill-prepare"> = {
          scan: null,
          outcomes: {},
        }
        void perform(() => prepareFields(message.retry)).then(respond, () =>
          respond(failed)
        )
        return true
      }
      case "autofill-write": {
        const { fills, force, identities, requestId } = message
        const url = scanUrl(location.href)
        const resolveSearch: ResolveSearch = async (fieldId, options) => {
          if (!requestId || !alive() || scanUrl(location.href) !== url)
            return null
          const response = await send({
            type: "autofill-resolve-search",
            requestId,
            fieldId,
            options,
          })
          if (
            !response ||
            typeof response !== "object" ||
            !("option" in response)
          )
            return null
          const option = response.option
          if (
            !option ||
            typeof option !== "object" ||
            !("id" in option) ||
            !("label" in option)
          )
            return null
          return (
            options.find(
              ({ id, label, description }) =>
                id === option.id &&
                label === option.label &&
                description ===
                  ("description" in option ? option.description : undefined)
            ) ?? null
          )
        }
        const failed: WorkerReply<"autofill-write"> = { results: {} }
        void perform(async (): Promise<WorkerReply<"autofill-write">> => {
          try {
            return {
              results: await writeAll(
                (id) => {
                  read()
                  const handle = handles.get(id)
                  return handle &&
                    alive() &&
                    scanUrl(location.href) === url &&
                    fieldIdentity(handle.descriptor) === identities[id]
                    ? handle
                    : undefined
                },
                fills,
                new Set(force),
                owner,
                resolveSearch
              ),
            }
          } finally {
            discovery.invalidate()
          }
        }).then(respond, () => respond(failed))
        return true
      }
      case "autofill-attach": {
        const failed: WorkerReply<"autofill-attach"> = { result: "failed" }
        void perform(async () => {
          try {
            return await attach(message)
          } finally {
            discovery.invalidate()
          }
        }).then(respond, () => respond(failed))
        return true
      }
      case "autofill-clear": {
        const failed: WorkerReply<"autofill-clear"> = { ok: false }
        void perform(() => clear(message.fieldId)).then(respond, () =>
          respond(failed)
        )
        return true
      }
      case "autofill-focus": {
        const failed: WorkerReply<"autofill-focus"> = { ok: false }
        void perform(() => focus(message.fieldId)).then(respond, () =>
          respond(failed)
        )
        return true
      }
      case "autofill-overlay": {
        if (
          message.postingKey !== undefined &&
          message.postingKey !== postingKey(new URL(location.href))
        ) {
          respond({ ok: false })
          return false
        }
        overlay.show(message.fieldIds, message.disabled)
        const reply: WorkerReply<"autofill-overlay"> = { ok: true }
        respond(reply)
        return false
      }
      case "autofill-draft-result": {
        if (
          message.postingKey !== undefined &&
          message.postingKey !== postingKey(new URL(location.href))
        ) {
          respond({ ok: false })
          return false
        }
        overlay.result(message.fieldId, message.text, message.error)
        const reply: WorkerReply<"autofill-draft-result"> = { ok: true }
        respond(reply)
        return false
      }
    }
  }

  const onProbe = (event: Event) => {
    if (alive()) event.preventDefault()
    else stop()
  }
  const onShow = (event: PageTransitionEvent) => {
    if (event.persisted) scan(true)
  }

  const observer = new MutationObserver(schedule)

  const stop = () => {
    clearTimeout(timer)
    timer = undefined
    observer.disconnect()
    watched?.unwatch()
    watched = null
    overlay.destroy()
    document.removeEventListener("input", schedule, true)
    document.removeEventListener("change", schedule, true)
    document.removeEventListener(PROBE, onProbe)
    window.removeEventListener("pageshow", onShow)
    try {
      chrome.runtime.onMessage.removeListener(onRuntime)
    } catch {
      /* The extension context is already gone. */
    }
  }

  // Keep scanning when document hydration replaces the root element.
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden"],
  })
  document.addEventListener("input", schedule, true)
  document.addEventListener("change", schedule, true)
  document.addEventListener(PROBE, onProbe)
  window.addEventListener("pageshow", onShow)
  chrome.runtime.onMessage.addListener(onRuntime)
  scan(true)
  return { stop }
}
