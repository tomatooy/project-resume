import { z } from "zod"
import { categoryOf, classifyPage, type Category } from "../lib/pages"

const ModeSchema = z.enum(["panel", "widget", "closed"])
export type Mode = z.infer<typeof ModeSchema>
export const ViewSchema = z.enum(["panel", "widget", "none"])
export type View = z.infer<typeof ViewSchema>

const TabStateSchema = z.object({
  job: ModeSchema,
  ats: ModeSchema,
  /** Location of the unsupported page where the toolbar opened the panel. */
  manual: z.string().nullable(),
  /** The toolbar could not run on this document; the tooltip says so. */
  blocked: z.boolean(),
  /** A host mounted by our content script, required on company pages. */
  hostDocumentId: z.string().nullable().default(null),
})
export type TabState = z.infer<typeof TabStateSchema>
export const initialTabState: TabState = {
  job: "panel",
  ats: "panel",
  manual: null,
  blocked: false,
  hostDocumentId: null,
}

export type Here = { category: Category; location: string | null }
export type TabEvent =
  | { type: "navigate"; document: boolean }
  | { type: "open" }
  | { type: "minimize" }
  | { type: "close" }
  | { type: "toolbar"; opening: boolean }
  | { type: "block" }

/** Origin and path. Query and hash changes stay on the same page. */
export function pageLocation(url: string | undefined): string | null {
  if (!url) return null
  try {
    const { protocol, host, pathname } = new URL(url)
    return `${protocol}//${host}${pathname}`
  } catch {
    return null
  }
}

export function locate(url: string | undefined): Here {
  return {
    category: categoryOf(classifyPage(url ?? "")),
    location: pageLocation(url),
  }
}

export function view(state: TabState, here: Here): View {
  if (here.category === "unsupported")
    return here.location !== null && state.manual === here.location
      ? "panel"
      : "none"
  const mode = state[here.category]
  return mode === "closed" ? "none" : mode
}

function withMode(
  state: TabState,
  category: Exclude<Category, "unsupported">,
  mode: Mode
): TabState {
  return category === "job" ? { ...state, job: mode } : { ...state, ats: mode }
}

export function transition(
  state: TabState,
  here: Here,
  event: TabEvent
): TabState {
  const { category, location } = here
  switch (event.type) {
    case "navigate": {
      const next = event.document
        ? { ...state, blocked: false, hostDocumentId: null }
        : state
      if (next.manual === null) return next
      // A panel the user opened stays open when the page becomes supported.
      if (category !== "unsupported")
        return { ...withMode(next, category, "panel"), manual: null }
      return event.document || location !== next.manual
        ? { ...next, manual: null }
        : next
    }
    case "open":
      return category === "unsupported"
        ? state
        : withMode(state, category, "panel")
    case "minimize":
      return category === "unsupported"
        ? state
        : withMode(state, category, "widget")
    case "close":
      return category === "unsupported"
        ? { ...state, manual: null }
        : withMode(state, category, "closed")
    case "toolbar":
      if (category === "unsupported")
        return { ...state, manual: event.opening ? location : null }
      return withMode(state, category, event.opening ? "panel" : "closed")
    case "block":
      return { ...state, manual: null, blocked: true }
  }
}

const key = (tabId: number) => `tab:${tabId}`
const queues = new Map<number, Promise<unknown>>()

/** Runs storage work for one tab in order, so read-modify-write never races. */
export function queued<T>(tabId: number, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(tabId) ?? Promise.resolve()).then(task, task)
  queues.set(tabId, next)
  const done = () => {
    if (queues.get(tabId) === next) queues.delete(tabId)
  }
  void next.then(done, done)
  return next
}

export async function readTabState(tabId: number): Promise<TabState> {
  const values = await chrome.storage.session.get(key(tabId))
  const parsed = TabStateSchema.safeParse(values[key(tabId)])
  return parsed.success ? parsed.data : initialTabState
}

export function updateTabState(
  tabId: number,
  change: (state: TabState) => TabState
): Promise<{ before: TabState; after: TabState }> {
  return queued(tabId, async () => {
    const before = await readTabState(tabId)
    const after = change(before)
    if (
      before.job !== after.job ||
      before.ats !== after.ats ||
      before.manual !== after.manual ||
      before.blocked !== after.blocked ||
      before.hostDocumentId !== after.hostDocumentId
    )
      await chrome.storage.session.set({ [key(tabId)]: after })
    return { before, after }
  })
}

export function forgetTab(tabId: number): Promise<void> {
  return queued(tabId, () => chrome.storage.session.remove(key(tabId)))
}

export async function moveTab(from: number, to: number): Promise<void> {
  const state = await queued(from, async () => {
    const value = await readTabState(from)
    await chrome.storage.session.remove(key(from))
    return value
  })
  await updateTabState(to, () => state)
}
