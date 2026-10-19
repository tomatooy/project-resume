import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { NotesState } from "@workspace/resume-core"
import { createElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type * as api from "@/lib/api"
import { ApiError } from "@/lib/types"

const server = vi.hoisted(() => ({
  getAutofillNotes: vi.fn<typeof api.getAutofillNotes>(),
  saveAutofillNotes: vi.fn<typeof api.saveAutofillNotes>(),
  restoreAutofillNoteVersion: vi.fn<typeof api.restoreAutofillNoteVersion>(),
}))
vi.mock("@/lib/api", () => server)

import { useNotesAutosave } from "./use-notes-autosave"

const CONFLICT_NOTICE =
  "This page changed somewhere else. We loaded the latest version."
const MINUTE = 60_000

const loaded: NotesState = {
  content: "- Prefers remote work",
  revision: 1,
  updatedAt: "2026-10-19T09:00:00.000Z",
}

function savedAt(revision: number) {
  return { revision, updatedAt: "2026-10-19T10:00:00.000Z" }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

function renderAutosave() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  const hook = renderHook(() => useNotesAutosave(loaded), { wrapper })
  return { client, ...hook }
}

/** Runs the clock and every promise it releases. */
async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe("useNotesAutosave", () => {
  it("saves once typing stops and snapshots only the session's first save", async () => {
    server.saveAutofillNotes
      .mockResolvedValueOnce(savedAt(2))
      .mockResolvedValueOnce(savedAt(3))
    const { result } = renderAutosave()

    act(() => result.current.update("- Prefers remote work\n- Speaks Dutch"))
    expect(result.current.content).toBe("- Prefers remote work\n- Speaks Dutch")
    await wait(799)
    expect(server.saveAutofillNotes).not.toHaveBeenCalled()
    await wait(1)
    expect(server.saveAutofillNotes).toHaveBeenCalledWith({
      content: "- Prefers remote work\n- Speaks Dutch",
      expectedRevision: 1,
      snapshot: true,
    })

    act(() => result.current.update("- Speaks Dutch"))
    await wait(800)
    expect(server.saveAutofillNotes).toHaveBeenLastCalledWith({
      content: "- Speaks Dutch",
      expectedRevision: 2,
      snapshot: false,
    })
  })

  it("snapshots again after 30 minutes without a save", async () => {
    server.saveAutofillNotes
      .mockResolvedValueOnce(savedAt(2))
      .mockResolvedValueOnce(savedAt(3))
    const { result } = renderAutosave()

    act(() => result.current.update("- a"))
    await wait(800)
    await wait(31 * MINUTE)
    act(() => result.current.update("- b"))
    await wait(800)

    expect(server.saveAutofillNotes).toHaveBeenLastCalledWith({
      content: "- b",
      expectedRevision: 2,
      snapshot: true,
    })
  })

  it("keeps the saved notes for the next visit", async () => {
    server.saveAutofillNotes.mockResolvedValue(savedAt(2))
    const { client, result } = renderAutosave()

    act(() => result.current.update("- a"))
    await wait(800)

    expect(client.getQueryData(["autofill", "notes"])).toEqual({
      content: "- a",
      revision: 2,
      updatedAt: "2026-10-19T10:00:00.000Z",
    })
  })

  it("loads the latest notes after a conflict and says so", async () => {
    server.saveAutofillNotes.mockRejectedValueOnce(
      new ApiError("CONFLICT", "Notes changed")
    )
    server.getAutofillNotes.mockResolvedValue({
      content: "- Merged by the extension",
      revision: 7,
      updatedAt: "2026-10-19T10:05:00.000Z",
    })
    const { result } = renderAutosave()

    act(() => result.current.update("- a"))
    await wait(800)
    await wait(50)

    expect(result.current.content).toBe("- Merged by the extension")
    expect(result.current.notice).toBe(CONFLICT_NOTICE)

    server.saveAutofillNotes.mockResolvedValueOnce(savedAt(8))
    act(() => result.current.update("- b"))
    expect(result.current.notice).toBeNull()
    await wait(800)
    expect(server.saveAutofillNotes).toHaveBeenLastCalledWith({
      content: "- b",
      expectedRevision: 7,
      snapshot: true,
    })
  })

  it("restores a version over the saved text", async () => {
    server.restoreAutofillNoteVersion.mockResolvedValue({
      content: "- Old fact",
      revision: 3,
      updatedAt: "2026-10-19T10:00:00.000Z",
    })
    server.saveAutofillNotes.mockResolvedValue(savedAt(4))
    const { client, result } = renderAutosave()

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.restore("v1")
    })

    expect(outcome).toBe("restored")
    expect(server.restoreAutofillNoteVersion).toHaveBeenCalledWith({
      id: "v1",
      expectedRevision: 1,
    })
    expect(result.current.content).toBe("- Old fact")
    expect(client.getQueryData(["autofill", "notes"])).toEqual({
      content: "- Old fact",
      revision: 3,
      updatedAt: "2026-10-19T10:00:00.000Z",
    })
    await wait(5000)
    expect(server.saveAutofillNotes).not.toHaveBeenCalled()

    act(() => result.current.update("- Old fact\n- New fact"))
    await wait(800)
    expect(server.saveAutofillNotes).toHaveBeenCalledWith({
      content: "- Old fact\n- New fact",
      expectedRevision: 3,
      snapshot: true,
    })
  })

  it("saves a pending edit before restoring", async () => {
    server.saveAutofillNotes.mockResolvedValue(savedAt(2))
    server.restoreAutofillNoteVersion.mockResolvedValue({
      content: "- Old fact",
      revision: 3,
      updatedAt: "2026-10-19T10:00:00.000Z",
    })
    const { result } = renderAutosave()

    act(() => result.current.update("- Typed just now"))
    await act(async () => {
      await result.current.restore("v1")
    })

    expect(server.saveAutofillNotes).toHaveBeenCalledWith({
      content: "- Typed just now",
      expectedRevision: 1,
      snapshot: true,
    })
    expect(server.restoreAutofillNoteVersion).toHaveBeenCalledWith({
      id: "v1",
      expectedRevision: 2,
    })
  })

  it("loads the latest notes when a restore conflicts", async () => {
    server.restoreAutofillNoteVersion.mockRejectedValue(
      new ApiError("CONFLICT", "Notes changed")
    )
    server.getAutofillNotes.mockResolvedValue({
      content: "- Merged by the extension",
      revision: 7,
      updatedAt: "2026-10-19T10:05:00.000Z",
    })
    const { result } = renderAutosave()

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.restore("v1")
    })

    expect(outcome).toBe("reloaded")
    expect(result.current.content).toBe("- Merged by the extension")
    expect(result.current.notice).toBe(CONFLICT_NOTICE)
  })

  it("clears the notice once a version is restored", async () => {
    server.saveAutofillNotes.mockRejectedValueOnce(
      new ApiError("CONFLICT", "Notes changed")
    )
    server.getAutofillNotes.mockResolvedValue({
      content: "- Merged by the extension",
      revision: 7,
      updatedAt: "2026-10-19T10:05:00.000Z",
    })
    server.restoreAutofillNoteVersion.mockResolvedValue({
      content: "- Old fact",
      revision: 8,
      updatedAt: "2026-10-19T10:06:00.000Z",
    })
    const { result } = renderAutosave()
    act(() => result.current.update("- a"))
    await wait(800)
    await wait(50)
    expect(result.current.notice).toBe(CONFLICT_NOTICE)

    await act(async () => {
      await result.current.restore("v1")
    })

    expect(server.restoreAutofillNoteVersion).toHaveBeenCalledWith({
      id: "v1",
      expectedRevision: 7,
    })
    expect(result.current.notice).toBeNull()
  })

  it("passes on a restore that failed for another reason", async () => {
    server.restoreAutofillNoteVersion.mockRejectedValue(new Error("offline"))
    const { result } = renderAutosave()

    await act(async () => {
      await expect(result.current.restore("v1")).rejects.toThrow("offline")
    })
    expect(result.current.content).toBe("- Prefers remote work")
  })

  it("saves a pending edit when the page closes", async () => {
    server.saveAutofillNotes.mockResolvedValue(savedAt(2))
    const { result, unmount } = renderAutosave()

    act(() => result.current.update("- a"))
    unmount()
    await wait(0)

    expect(server.saveAutofillNotes).toHaveBeenCalledWith({
      content: "- a",
      expectedRevision: 1,
      snapshot: true,
    })
  })

  it("warns before the browser leaves with an unsaved edit", async () => {
    server.saveAutofillNotes.mockResolvedValue(savedAt(2))
    const { result } = renderAutosave()
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }

    expect(leave()).toBe(false)
    act(() => result.current.update("- a"))
    expect(leave()).toBe(true)
    await wait(800)
    expect(leave()).toBe(false)
  })
})
