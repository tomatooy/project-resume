import { describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/types"
import {
  characters,
  createEditSession,
  notesCount,
  notesWriter,
  REASON_LABELS,
} from "./notes-session"

const MINUTE = 60_000

describe("createEditSession", () => {
  it("snapshots the first save of a session", () => {
    const session = createEditSession(() => 0)

    expect(session.needsSnapshot()).toBe(true)
  })

  it("does not snapshot again within 30 minutes", () => {
    let now = 0
    const session = createEditSession(() => now)
    session.saved()

    now = 29 * MINUTE
    expect(session.needsSnapshot()).toBe(false)
  })

  it("snapshots again after 30 minutes without a save", () => {
    let now = 0
    const session = createEditSession(() => now)
    session.saved()

    now = 31 * MINUTE
    expect(session.needsSnapshot()).toBe(true)
  })

  it("counts the 30 minutes from the latest save", () => {
    let now = 0
    const session = createEditSession(() => now)
    session.saved()
    now = 20 * MINUTE
    session.saved()

    now = 40 * MINUTE
    expect(session.needsSnapshot()).toBe(false)
  })

  it("starts a new session at exactly 30 minutes", () => {
    let now = 0
    const session = createEditSession(() => now)
    session.saved()

    now = 30 * MINUTE
    expect(session.needsSnapshot()).toBe(true)
  })
})

describe("notesCount", () => {
  it("formats the count", () => {
    expect(notesCount(1234)).toBe("1,234 / 10,000")
    expect(notesCount(0)).toBe("0 / 10,000")
  })
})

describe("characters", () => {
  it("names a version's length", () => {
    expect(characters(1)).toBe("1 character")
    expect(characters(0)).toBe("0 characters")
    expect(characters(1234)).toBe("1,234 characters")
  })
})

describe("REASON_LABELS", () => {
  it("names why each snapshot was taken", () => {
    expect(REASON_LABELS).toEqual({
      merge: "Before notes update",
      edit: "Before editing",
      restore: "Before restore",
    })
  })
})

describe("notesWriter", () => {
  function writer(
    save: () => Promise<{ revision: number; updatedAt: string }>,
    snapshot = true
  ) {
    const session = {
      needsSnapshot: vi.fn(() => snapshot),
      saved: vi.fn<() => void>(),
    }
    const onSaved = vi.fn<(revision: number) => void>()
    const onConflict = vi.fn<() => void>()
    const spy = vi.fn(save)
    const write = notesWriter({
      read: () => ({ content: "- Prefers remote work", revision: 4 }),
      save: spy,
      session,
      onSaved,
      onConflict,
    })
    return { write, save: spy, session, onSaved, onConflict }
  }

  it("asks the session whether to snapshot and marks the save", async () => {
    const { write, save, session, onSaved } = writer(async () => ({
      revision: 5,
      updatedAt: "2026-10-19T10:00:00.000Z",
    }))

    expect(await write()).toBe("ok")
    expect(save).toHaveBeenCalledWith({
      content: "- Prefers remote work",
      expectedRevision: 4,
      snapshot: true,
    })
    expect(session.saved).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledWith(5)
  })

  it("writes without a snapshot later in the session", async () => {
    const { write, save } = writer(
      async () => ({ revision: 5, updatedAt: "2026-10-19T10:00:00.000Z" }),
      false
    )

    await write()
    expect(save).toHaveBeenCalledWith({
      content: "- Prefers remote work",
      expectedRevision: 4,
      snapshot: false,
    })
  })

  it("reports a conflict and asks for a reload", async () => {
    const { write, session, onSaved, onConflict } = writer(async () => {
      throw new ApiError("CONFLICT", "Notes changed")
    })

    expect(await write()).toBe("conflict")
    expect(onConflict).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
    expect(session.saved).not.toHaveBeenCalled()
  })

  it("retries on other errors without ending the session's first save", async () => {
    const { write, session, onConflict } = writer(async () => {
      throw new Error("offline")
    })

    expect(await write()).toBe("retry")
    expect(onConflict).not.toHaveBeenCalled()
    expect(session.saved).not.toHaveBeenCalled()
  })
})
