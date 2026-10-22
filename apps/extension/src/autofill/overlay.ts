import type { ContentMessage } from "../lib/autofill-protocol"
import { clip, LIMITS, setNativeValue } from "./dom"
import type { Owner } from "./owner"

/*
 * Write with AI on the page (spec 7): a button under each field of that group
 * and a popover with the draft. It sits in a closed shadow root on the
 * document element, outside the vendor's form, so the page can neither style
 * nor reach it. The content script cannot import `src/lib`, so the overlay's
 * own copy is here; error and limit lines come from the service worker.
 */

const HOST_ID = "vs-resume-autofill"
const WRITE = "Write with AI"
const INSTRUCTION = "Optional instruction"
const WRITING = "Writing a draft..."
const INSERT = "Insert"
const REPLACE = "Replace"
const REGENERATE = "Regenerate"
const CLOSE = "Close"
/** The panel's draft failure line, for a reply that never comes. */
const NO_REPLY = "Couldn't write a draft. Try again."

/** Longer than the service worker waits on the server (35 s). */
const WAIT_MS = 45_000
/** Space between the field and its button. */
const GAP = 6
const POPOVER_WIDTH = 360
/** The popover keeps this far from the viewport's left edge. */
const MARGIN = 8

/*
 * Neither the page's styles nor the app's palette reach the closed shadow
 * root, so the overlay keeps its own light palette, named by the roles in
 * docs/design/style-colors.md. Rules below use only these.
 */
const PALETTE = `
  --foreground: #18181b;
  --muted-foreground: #52525b;
  --card: #fff;
  --muted: #fafafa;
  --accent: #f4f4f5;
  --border: #e4e4e7;
  --input: #d4d4d8;
  --primary: #18181b;
  --primary-foreground: #fff;
  --warning: #b45309;
`

const CSS = `
.anchor {
  ${PALETTE}
  position: absolute;
  transform: translateX(-100%);
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--foreground);
  color-scheme: light;
}
.anchor.open { z-index: 1; }
button { margin: 0; font: inherit; border-radius: 6px; cursor: pointer; }
button:disabled { cursor: default; opacity: 0.5; }
button:focus-visible, .instruction:focus-visible {
  outline: 2px solid var(--foreground);
  outline-offset: 2px;
}
.write {
  display: block;
  padding: 3px 10px;
  border: 1px solid var(--input);
  border-radius: 999px;
  background: var(--card);
  color: var(--foreground);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--foreground) 6%, transparent);
}
.write:hover:not(:disabled), .secondary:hover:not(:disabled) { background: var(--accent); }
.popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  box-sizing: border-box;
  width: min(${POPOVER_WIDTH}px, calc(100vw - ${2 * MARGIN}px));
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--card);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--foreground) 14%, transparent);
  text-align: left;
}
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.title { font-weight: 600; }
.close {
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 18px;
  line-height: 1;
}
.close:hover { color: var(--foreground); }
.status { margin: 0; color: var(--muted-foreground); font-size: 12px; }
.status.warn { color: var(--warning); }
.draft {
  max-height: 240px;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.instruction {
  box-sizing: border-box;
  width: 100%;
  min-height: 52px;
  padding: 6px 8px;
  border: 1px solid var(--input);
  border-radius: 6px;
  background: var(--card);
  color: inherit;
  font: inherit;
  font-size: 12px;
  resize: vertical;
}
.actions { display: flex; justify-content: flex-end; gap: 8px; }
.primary, .secondary { padding: 6px 12px; font-size: 12px; font-weight: 500; }
.primary { border: 1px solid var(--primary); background: var(--primary); color: var(--primary-foreground); }
.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--primary) 92%, var(--primary-foreground)); }
.secondary { border: 1px solid var(--input); background: var(--card); color: var(--foreground); }
[hidden] { display: none !important; }
`

export type OverlayMessage = Extract<
  ContentMessage,
  { type: "autofill-draft" | "autofill-inserted" }
>

export type Overlay = {
  /** A button under each field; `disabled` says why none can draft now. */
  show(fieldIds: string[], disabled: string | null): void
  /** Settles the field's draft request with a draft or the reason for none. */
  result(fieldId: string, text: string | null, error: string | null): void
  /** Puts the buttons under their fields again, as found now. */
  layout(): void
  destroy(): void
}

type Draft = {
  text: string | null
  error: string | null
  pending: boolean
  instruction: string
  timer: ReturnType<typeof setTimeout> | undefined
}

type Anchor = { root: HTMLDivElement; write: HTMLButtonElement }

function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function button(className: string, text: string): HTMLButtonElement {
  const element = create("button", className, text)
  element.type = "button"
  return element
}

function adoptStyles(shadow: ShadowRoot): void {
  // A constructed sheet is not inline CSS, so a strict page CSP allows it.
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(CSS)
    shadow.adoptedStyleSheets = [sheet]
  } catch {
    // Without constructed sheets (jsdom), a style element does.
    const style = document.createElement("style")
    style.textContent = CSS
    shadow.append(style)
  }
}

/**
 * The Write with AI overlay. A trusted click on a field's button opens its
 * popover and asks for a draft; nothing reaches the field until Insert.
 */
export function createOverlay(options: {
  send: (message: OverlayMessage) => void
  field: (fieldId: string) => HTMLInputElement | HTMLTextAreaElement | undefined
  owner: Owner
  isTrusted?: (event: Event) => boolean
}): Overlay {
  const isTrusted = options.isTrusted ?? ((event: Event) => event.isTrusted)
  // A host left by an older install goes; its script has stopped.
  document.getElementById(HOST_ID)?.remove()
  const host = document.createElement("div")
  host.id = HOST_ID
  host.style.cssText =
    "all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;"
  const shadow = host.attachShadow({ mode: "closed" })
  adoptStyles(shadow)
  // Keys typed into the popover stay away from the page's shortcuts.
  for (const type of ["keydown", "keyup", "keypress"])
    host.addEventListener(type, (event) => event.stopPropagation())

  const anchors = new Map<string, Anchor>()
  const drafts = new Map<string, Draft>()
  let disabled: string | null = null
  let open: string | null = null
  let frame = 0

  const popover = create("div", "popover")
  popover.setAttribute("role", "dialog")
  popover.setAttribute("aria-label", WRITE)
  const close = button("close", "×")
  close.title = CLOSE
  close.setAttribute("aria-label", CLOSE)
  const head = create("div", "head")
  head.append(create("span", "title", WRITE), close)
  const status = create("p", "status")
  status.setAttribute("role", "status")
  const text = create("div", "draft")
  const instruction = create("textarea", "instruction")
  instruction.placeholder = INSTRUCTION
  instruction.maxLength = LIMITS.instruction
  instruction.rows = 2
  const regenerate = button("secondary", REGENERATE)
  const insert = button("primary", INSERT)
  const actions = create("div", "actions")
  actions.append(regenerate, insert)
  popover.append(head, status, text, instruction, actions)

  const stateOf = (fieldId: string): Draft => {
    let state = drafts.get(fieldId)
    if (!state) {
      state = {
        text: null,
        error: null,
        pending: false,
        instruction: "",
        timer: undefined,
      }
      drafts.set(fieldId, state)
    }
    return state
  }

  const render = () => {
    for (const [fieldId, { root, write }] of anchors) {
      write.disabled = disabled !== null
      if (disabled === null) write.removeAttribute("title")
      else write.title = disabled
      write.setAttribute("aria-expanded", String(open === fieldId))
      root.classList.toggle("open", open === fieldId)
    }
    if (open === null) return
    const state = stateOf(open)
    const line = state.pending ? WRITING : (state.error ?? disabled)
    status.textContent = line ?? ""
    status.hidden = line === null
    status.classList.toggle("warn", !state.pending && line !== null)
    text.textContent = state.text ?? ""
    text.hidden = state.text === null
    const target = options.field(open)
    insert.textContent = target && target.value.trim() !== "" ? REPLACE : INSERT
    insert.disabled = state.pending || state.text === null || !target
    regenerate.disabled = state.pending || disabled !== null
  }

  /** Puts each button under its field's right edge, reading every field first. */
  const place = () => {
    const { scrollX, scrollY, innerWidth } = window
    const spots = [...anchors].map(([fieldId, anchor]) => {
      const target = options.field(fieldId)
      const rect = target?.isConnected ? target.getBoundingClientRect() : null
      const shown = rect !== null && (rect.width > 0 || rect.height > 0)
      return { fieldId, anchor, rect: shown ? rect : null }
    })
    for (const { fieldId, anchor, rect } of spots) {
      anchor.root.hidden = rect === null
      if (!rect) continue
      anchor.root.style.top = `${rect.bottom + scrollY + GAP}px`
      anchor.root.style.left = `${rect.right + scrollX}px`
      if (fieldId !== open) continue
      // A field near the left edge would push the popover off the screen.
      const width = Math.min(POPOVER_WIDTH, innerWidth - 2 * MARGIN)
      popover.style.right = `${Math.min(0, rect.right - width - MARGIN)}px`
    }
  }

  const schedule = () => {
    if (frame !== 0 || anchors.size === 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      place()
    })
  }

  const layout = () => {
    // The page may have dropped the host; it comes back while buttons show.
    if (anchors.size === 0) host.remove()
    else if (!host.isConnected) document.documentElement.append(host)
    place()
    render()
  }

  const request = (fieldId: string) => {
    const state = stateOf(fieldId)
    const typed = clip(state.instruction.trim(), LIMITS.instruction)
    clearTimeout(state.timer)
    state.pending = true
    state.error = null
    // A service worker stopped mid-call never replies.
    state.timer = setTimeout(() => {
      state.timer = undefined
      state.pending = false
      state.error = NO_REPLY
      render()
    }, WAIT_MS)
    options.send(
      typed
        ? { type: "autofill-draft", fieldId, instruction: typed }
        : { type: "autofill-draft", fieldId }
    )
  }

  const openFor = (fieldId: string) => {
    const anchor = anchors.get(fieldId)
    if (!anchor) return
    open = fieldId
    instruction.value = stateOf(fieldId).instruction
    anchor.root.append(popover)
    place()
  }

  const closePopover = (refocus: boolean) => {
    const fieldId = open
    open = null
    popover.remove()
    render()
    if (refocus && fieldId !== null) anchors.get(fieldId)?.write.focus()
  }

  const anchorFor = (fieldId: string): Anchor => {
    const root = create("div", "anchor")
    const write = button("write", WRITE)
    write.setAttribute("aria-haspopup", "dialog")
    write.addEventListener("click", (event) => {
      if (!isTrusted(event) || disabled !== null) return
      if (open === fieldId) {
        closePopover(false)
        return
      }
      openFor(fieldId)
      const state = stateOf(fieldId)
      if (state.text === null && !state.pending) request(fieldId)
      render()
    })
    root.append(write)
    shadow.append(root)
    return { root, write }
  }

  close.addEventListener("click", (event) => {
    if (isTrusted(event)) closePopover(true)
  })
  popover.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isTrusted(event)) return
    event.preventDefault()
    closePopover(true)
  })
  instruction.addEventListener("input", () => {
    if (open !== null) stateOf(open).instruction = instruction.value
  })
  regenerate.addEventListener("click", (event) => {
    if (!isTrusted(event) || open === null || disabled !== null) return
    if (stateOf(open).pending) return
    request(open)
    render()
  })
  insert.addEventListener("click", (event) => {
    if (!isTrusted(event) || open === null) return
    const fieldId = open
    const { text: draft, pending } = stateOf(fieldId)
    const target = options.field(fieldId)
    if (draft === null || pending || !target) return
    // Marked ours first, so the next scan does not take the draft for theirs.
    options.owner.markOurs(fieldId)
    setNativeValue(target, draft)
    options.send({ type: "autofill-inserted", fieldId })
    closePopover(true)
  })

  window.addEventListener("scroll", schedule, { capture: true, passive: true })
  window.addEventListener("resize", schedule, { passive: true })

  return {
    show(fieldIds, next) {
      disabled = next
      const wanted = new Set(fieldIds)
      for (const [fieldId, anchor] of anchors) {
        if (wanted.has(fieldId)) continue
        if (open === fieldId) {
          open = null
          popover.remove()
        }
        anchor.root.remove()
        anchors.delete(fieldId)
        // Drafts are kept nowhere else, and only while the field has a button.
        clearTimeout(drafts.get(fieldId)?.timer)
        drafts.delete(fieldId)
      }
      for (const fieldId of wanted)
        if (!anchors.has(fieldId)) anchors.set(fieldId, anchorFor(fieldId))
      layout()
    },
    result(fieldId, draft, error) {
      const state = drafts.get(fieldId)
      if (!anchors.has(fieldId) || !state?.pending) return
      clearTimeout(state.timer)
      state.timer = undefined
      state.pending = false
      if (draft !== null) state.text = draft
      state.error = error
      render()
    },
    layout,
    destroy() {
      for (const { timer } of drafts.values()) clearTimeout(timer)
      if (frame !== 0) cancelAnimationFrame(frame)
      frame = 0
      window.removeEventListener("scroll", schedule, true)
      window.removeEventListener("resize", schedule)
      host.remove()
      anchors.clear()
      drafts.clear()
      open = null
    },
  }
}
