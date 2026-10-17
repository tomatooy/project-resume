import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  forgetTab,
  initialTabState,
  locate,
  moveTab,
  pageLocation,
  readTabState,
  transition,
  updateTabState,
  view,
} from "../src/background/tab-state"

const job = locate("https://www.linkedin.com/jobs/view/123456/")
const ats = locate("https://boards.greenhouse.io/acme/jobs/1")
const other = locate("https://example.test/a?x=1")
const session: Record<string, unknown> = {}
const set = vi.fn(async (values: Record<string, unknown>) => {
  Object.assign(session, values)
})

beforeEach(() => {
  for (const key of Object.keys(session)) delete session[key]
  set.mockClear()
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: async (key: string) =>
          key in session ? { [key]: session[key] } : {},
        set,
        remove: async (key: string) => {
          delete session[key]
        },
      },
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

it("compares pages by origin and path only", () => {
  expect(pageLocation("https://example.test/a?x=1#y")).toBe(
    "https://example.test/a"
  )
  expect(pageLocation(undefined)).toBeNull()
  expect(pageLocation("not a url")).toBeNull()
  expect(locate(undefined)).toEqual({ category: "unsupported", location: null })
})

it("opens supported pages by default and leaves other pages alone", () => {
  expect(view(initialTabState, job)).toBe("panel")
  expect(view(initialTabState, ats)).toBe("panel")
  expect(view(initialTabState, other)).toBe("none")
  for (const type of ["open", "minimize"] as const)
    expect(transition(initialTabState, other, { type })).toBe(initialTabState)
})

it("minimizes, closes and reopens each category on its own", () => {
  let state = transition(initialTabState, job, { type: "minimize" })
  expect([view(state, job), view(state, ats)]).toEqual(["widget", "panel"])
  state = transition(state, job, { type: "close" })
  expect(view(state, job)).toBe("none")
  state = transition(state, job, { type: "navigate", document: true })
  expect(view(state, job)).toBe("none")
  state = transition(state, job, { type: "toolbar", opening: true })
  expect(view(state, job)).toBe("panel")
  state = transition(state, ats, { type: "toolbar", opening: false })
  expect([view(state, job), view(state, ats)]).toEqual(["panel", "none"])
  state = transition(state, ats, { type: "open" })
  expect(view(state, ats)).toBe("panel")
})

it("keeps a toolbar panel on an unsupported page until that page changes", () => {
  const opened = transition(initialTabState, other, {
    type: "toolbar",
    opening: true,
  })
  expect(view(opened, other)).toBe("panel")
  const hash = locate("https://example.test/a?x=2#top")
  expect(
    view(transition(opened, hash, { type: "navigate", document: false }), hash)
  ).toBe("panel")
  const path = locate("https://example.test/b")
  expect(
    transition(opened, path, { type: "navigate", document: false }).manual
  ).toBeNull()
  expect(
    transition(opened, other, { type: "navigate", document: true }).manual
  ).toBeNull()
  expect(transition(opened, other, { type: "close" }).manual).toBeNull()
  expect(
    transition(opened, other, { type: "toolbar", opening: false }).manual
  ).toBeNull()
})

it("carries a toolbar panel onto a supported page", () => {
  const opened = transition({ ...initialTabState, job: "closed" }, other, {
    type: "toolbar",
    opening: true,
  })
  expect(transition(opened, job, { type: "navigate", document: true })).toEqual(
    { ...initialTabState, job: "panel" }
  )
})

it("clears the restricted-page flag only when a new document loads", () => {
  const blocked = transition(initialTabState, locate(undefined), {
    type: "block",
  })
  expect(blocked.blocked).toBe(true)
  expect(
    transition(blocked, other, { type: "navigate", document: false }).blocked
  ).toBe(true)
  expect(
    transition(blocked, other, { type: "navigate", document: true }).blocked
  ).toBe(false)
})

it("falls back to defaults for missing or malformed stored state", async () => {
  expect(await readTabState(1)).toEqual(initialTabState)
  session["tab:1"] = { job: "open" }
  expect(await readTabState(1)).toEqual(initialTabState)
})

it("applies one tab's updates in order and skips writes that change nothing", async () => {
  await Promise.all([
    updateTabState(1, (state) => ({
      ...state,
      job: state.job === "panel" ? "widget" : "panel",
    })),
    updateTabState(1, (state) => ({
      ...state,
      job: state.job === "widget" ? "closed" : "panel",
    })),
  ])
  expect(await readTabState(1)).toMatchObject({ job: "closed" })
  set.mockClear()
  await updateTabState(1, (state) => ({ ...state }))
  expect(set).not.toHaveBeenCalled()
})

it("moves state to a replacement tab and forgets closed tabs", async () => {
  await updateTabState(1, (state) => ({ ...state, ats: "closed" }))
  await moveTab(1, 2)
  expect(session["tab:1"]).toBeUndefined()
  expect(await readTabState(2)).toMatchObject({ ats: "closed" })
  await forgetTab(2)
  expect(session).toEqual({})
})
