import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { emptyProfile, type Profile } from "@workspace/autofill"
import type { ProfileState } from "@workspace/resume-core"
import { createElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type * as api from "@/lib/api"
import { ApiError } from "@/lib/types"

const server = vi.hoisted(() => ({
  getAutofillProfile: vi.fn<typeof api.getAutofillProfile>(),
  saveAutofillProfile: vi.fn<typeof api.saveAutofillProfile>(),
}))
vi.mock("@/lib/api", () => server)

import { profileWriter, useProfileAutosave } from "./use-profile-autosave"

const CONFLICT_NOTICE =
  "This page changed somewhere else. We loaded the latest version."

function named(first: string): Profile {
  return { ...emptyProfile, personal: { ...emptyProfile.personal, first } }
}

describe("profileWriter", () => {
  function writer(
    save: () => Promise<{ revision: number; updatedAt: string }>
  ) {
    const onSaved = vi.fn<(revision: number) => void>()
    const onConflict = vi.fn<() => void>()
    const spy = vi.fn(save)
    const write = profileWriter({
      read: () => ({ profile: named("Ada"), revision: 1 }),
      save: spy,
      onSaved,
      onConflict,
    })
    return { write, save: spy, onSaved, onConflict }
  }

  it("writes the profile and keeps the new revision", async () => {
    const { write, save, onSaved, onConflict } = writer(async () => ({
      revision: 2,
      updatedAt: "2026-10-19T10:00:00.000Z",
    }))

    expect(await write()).toBe("ok")
    expect(save).toHaveBeenCalledWith({
      profile: named("Ada"),
      expectedRevision: 1,
    })
    expect(onSaved).toHaveBeenCalledWith(2)
    expect(onConflict).not.toHaveBeenCalled()
  })

  it("reports a conflict and asks for a reload", async () => {
    const { write, onSaved, onConflict } = writer(async () => {
      throw new ApiError("CONFLICT", "Profile changed")
    })

    expect(await write()).toBe("conflict")
    expect(onConflict).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it("retries on other errors", async () => {
    const { write, onSaved, onConflict } = writer(async () => {
      throw new Error("offline")
    })

    expect(await write()).toBe("retry")
    expect(onConflict).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })
})

describe("useProfileAutosave", () => {
  const loaded: ProfileState = {
    profile: named("Ada"),
    revision: 1,
    updatedAt: "2026-10-19T09:00:00.000Z",
    exists: true,
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
    const hook = renderHook(() => useProfileAutosave(loaded), { wrapper })
    return { client, ...hook }
  }

  /** Runs the clock and every promise it releases. */
  async function wait(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it("saves an edit once typing stops, at the revision it last saved", async () => {
    server.saveAutofillProfile
      .mockResolvedValueOnce({
        revision: 2,
        updatedAt: "2026-10-19T10:00:00.000Z",
      })
      .mockResolvedValueOnce({
        revision: 3,
        updatedAt: "2026-10-19T10:01:00.000Z",
      })
    const { result } = renderAutosave()

    act(() => result.current.update(named("Grace")))
    expect(result.current.profile).toEqual(named("Grace"))
    await wait(799)
    expect(server.saveAutofillProfile).not.toHaveBeenCalled()
    await wait(1)
    expect(server.saveAutofillProfile).toHaveBeenCalledWith({
      profile: named("Grace"),
      expectedRevision: 1,
    })

    act(() => result.current.update(named("Hedy")))
    await wait(800)
    expect(server.saveAutofillProfile).toHaveBeenLastCalledWith({
      profile: named("Hedy"),
      expectedRevision: 2,
    })
  })

  it("keeps the saved profile for the next visit", async () => {
    server.saveAutofillProfile.mockResolvedValue({
      revision: 2,
      updatedAt: "2026-10-19T10:00:00.000Z",
    })
    const { client, result } = renderAutosave()

    act(() => result.current.update(named("Grace")))
    await wait(800)

    expect(client.getQueryData(["autofill", "profile"])).toEqual({
      profile: named("Grace"),
      revision: 2,
      updatedAt: "2026-10-19T10:00:00.000Z",
      exists: true,
    })
  })

  it("holds an edit the schema would reject", async () => {
    const { result } = renderAutosave()

    act(() =>
      result.current.update({
        ...emptyProfile,
        contact: { ...emptyProfile.contact, email: "ada@" },
      })
    )
    await wait(5000)

    expect(server.saveAutofillProfile).not.toHaveBeenCalled()
  })

  it("does not write a profile nobody changed", async () => {
    renderAutosave()
    await wait(5000)

    expect(server.saveAutofillProfile).not.toHaveBeenCalled()
  })

  it("loads the latest version after a conflict and says so", async () => {
    server.saveAutofillProfile.mockRejectedValueOnce(
      new ApiError("CONFLICT", "Profile changed")
    )
    server.getAutofillProfile.mockResolvedValue({
      profile: named("Katherine"),
      revision: 5,
      updatedAt: "2026-10-19T10:05:00.000Z",
      exists: true,
    })
    const { result } = renderAutosave()

    act(() => result.current.update(named("Grace")))
    await wait(800)
    await wait(50)

    expect(result.current.profile).toEqual(named("Katherine"))
    expect(result.current.notice).toBe(CONFLICT_NOTICE)

    server.saveAutofillProfile.mockResolvedValueOnce({
      revision: 6,
      updatedAt: "2026-10-19T10:06:00.000Z",
    })
    act(() => result.current.update(named("Hedy")))
    expect(result.current.notice).toBeNull()
    await wait(800)
    expect(server.saveAutofillProfile).toHaveBeenLastCalledWith({
      profile: named("Hedy"),
      expectedRevision: 5,
    })
  })

  it("saves a pending edit when the page closes", async () => {
    server.saveAutofillProfile.mockResolvedValue({
      revision: 2,
      updatedAt: "2026-10-19T10:00:00.000Z",
    })
    const { result, unmount } = renderAutosave()

    act(() => result.current.update(named("Grace")))
    unmount()
    await wait(0)

    expect(server.saveAutofillProfile).toHaveBeenCalledWith({
      profile: named("Grace"),
      expectedRevision: 1,
    })
  })

  it("warns before the browser leaves with an unsaved edit", async () => {
    server.saveAutofillProfile.mockResolvedValue({
      revision: 2,
      updatedAt: "2026-10-19T10:00:00.000Z",
    })
    const { result } = renderAutosave()
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }

    expect(leave()).toBe(false)
    act(() => result.current.update(named("Grace")))
    expect(leave()).toBe(true)
    await wait(800)
    expect(leave()).toBe(false)
  })
})
