import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import type {
  NotesState,
  NoteVersion,
  NoteVersionContent,
} from "@workspace/resume-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import type * as api from "@/lib/api"
import { ApiError } from "@/lib/types"

const server = vi.hoisted(() => ({
  getAutofillNotes: vi.fn<typeof api.getAutofillNotes>(),
  saveAutofillNotes: vi.fn<typeof api.saveAutofillNotes>(),
  listAutofillNoteVersions: vi.fn<typeof api.listAutofillNoteVersions>(),
  getAutofillNoteVersion: vi.fn<typeof api.getAutofillNoteVersion>(),
  restoreAutofillNoteVersion: vi.fn<typeof api.restoreAutofillNoteVersion>(),
}))
vi.mock("@/lib/api", () => server)
const notify = vi.hoisted(() => ({ error: vi.fn<(message: string) => void>() }))
vi.mock("sonner", () => ({ toast: notify }))

import { NotesEditor } from "./NotesEditor"

const WARNING = "Notes are almost full. Clean up facts you no longer need."
const CONFLICT_NOTICE =
  "This page changed somewhere else. We loaded the latest version."

/** The snapshot most tests restore, as History lists it and as it previews. */
const EARLIER: NoteVersion = {
  id: "6f1c2a7e-0d5b-4c8e-9a51-1b2c3d4e5f60",
  reason: "edit",
  createdAt: "2026-10-18T08:00:00.000Z",
  length: 10,
}
const EARLIER_TEXT: NoteVersionContent = {
  id: EARLIER.id,
  reason: EARLIER.reason,
  createdAt: EARLIER.createdAt,
  content: "- Old fact",
}
const MERGED: NoteVersion = {
  id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  reason: "merge",
  createdAt: "2026-10-19T08:30:00.000Z",
  length: 1234,
}

function renderEditor(content: string) {
  // As in the app, a loaded query counts as fresh for 30 seconds.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  })
  const state: NotesState = {
    content,
    revision: 1,
    updatedAt: "2026-10-19T09:00:00.000Z",
  }
  render(
    <QueryClientProvider client={client}>
      <NotesEditor state={state} />
    </QueryClientProvider>
  )
  return { user: userEvent.setup() }
}

async function openHistory(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: "History" }))
  return screen.findByRole("dialog", { name: "History" })
}

/** Picks the earlier version and waits for its text. */
async function pickEarlier(user: UserEvent, dialog: HTMLElement) {
  await user.click(
    await within(dialog).findByRole("button", { name: /Before editing/ })
  )
  await within(dialog).findByText("- Old fact")
}

afterEach(() => {
  vi.resetAllMocks()
})

describe("NotesEditor", () => {
  it("counts the characters against the limit", async () => {
    const { user } = renderEditor("")
    const notes = screen.getByRole("textbox", { name: "Notes" })
    expect(screen.getByText("0 / 10,000")).toBeInTheDocument()
    expect(notes).toHaveAttribute("maxlength", "10000")

    await user.type(notes, "- Dutch")

    expect(screen.getByText("7 / 10,000")).toBeInTheDocument()
  })

  it("warns from 9,000 characters", async () => {
    const { user } = renderEditor("x".repeat(8999))
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument()

    const notes = screen.getByRole("textbox", { name: "Notes" })
    await user.type(notes, "x")

    expect(screen.getByText(WARNING)).toBeInTheDocument()
    expect(notes).toHaveAccessibleDescription(WARNING)
  })

  it("loads History afresh each time it opens", async () => {
    server.listAutofillNoteVersions
      .mockResolvedValueOnce([EARLIER])
      .mockResolvedValueOnce([MERGED, EARLIER])
    const { user } = renderEditor("- Prefers remote work")

    const first = await openHistory(user)
    await within(first).findByRole("button", { name: /Before editing/ })
    await user.click(within(first).getByRole("button", { name: "Close" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    const second = await openHistory(user)

    expect(
      await within(second).findByRole("button", { name: /Before notes update/ })
    ).toBeInTheDocument()
  })

  it("lists the snapshots newest first, previews one and restores it", async () => {
    server.listAutofillNoteVersions.mockResolvedValue([MERGED, EARLIER])
    server.getAutofillNoteVersion.mockResolvedValue(EARLIER_TEXT)
    server.restoreAutofillNoteVersion.mockResolvedValue({
      content: "- Old fact",
      revision: 3,
      updatedAt: "2026-10-19T10:00:00.000Z",
    })
    const { user } = renderEditor("- Prefers remote work")

    const dialog = await openHistory(user)
    const newer = await within(dialog).findByRole("button", {
      name: /Before notes update/,
    })
    const older = within(dialog).getByRole("button", { name: /Before editing/ })
    expect(newer).toHaveTextContent("1,234 characters")
    expect(
      newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      within(dialog).getByText("Choose a version to see its text.")
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole("button", { name: "Restore" })
    ).toBeDisabled()

    await user.click(older)
    expect(older).toHaveAttribute("aria-pressed", "true")
    expect(newer).toHaveAttribute("aria-pressed", "false")
    expect(await within(dialog).findByText("- Old fact")).toBeInTheDocument()
    expect(server.getAutofillNoteVersion).toHaveBeenCalledWith({
      id: EARLIER.id,
    })

    await user.click(within(dialog).getByRole("button", { name: "Restore" }))

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(server.restoreAutofillNoteVersion).toHaveBeenCalledWith({
      id: EARLIER.id,
      expectedRevision: 1,
    })
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue(
      "- Old fact"
    )
  })

  it("closes History and says so when the notes changed elsewhere", async () => {
    server.listAutofillNoteVersions.mockResolvedValue([EARLIER])
    server.getAutofillNoteVersion.mockResolvedValue(EARLIER_TEXT)
    server.restoreAutofillNoteVersion.mockRejectedValue(
      new ApiError("CONFLICT", "Notes changed")
    )
    server.getAutofillNotes.mockResolvedValue({
      content: "- Merged by the extension",
      revision: 7,
      updatedAt: "2026-10-19T10:05:00.000Z",
    })
    const { user } = renderEditor("- Prefers remote work")

    const dialog = await openHistory(user)
    await pickEarlier(user, dialog)
    await user.click(within(dialog).getByRole("button", { name: "Restore" }))

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue(
      "- Merged by the extension"
    )
    expect(screen.getByRole("status")).toHaveTextContent(CONFLICT_NOTICE)
  })

  it("keeps History open and says why when a restore fails", async () => {
    server.listAutofillNoteVersions.mockResolvedValue([EARLIER])
    server.getAutofillNoteVersion.mockResolvedValue(EARLIER_TEXT)
    let fail: (error: Error) => void = () => undefined
    server.restoreAutofillNoteVersion.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject
      })
    )
    const { user } = renderEditor("- Prefers remote work")

    const dialog = await openHistory(user)
    await pickEarlier(user, dialog)
    const restore = within(dialog).getByRole("button", { name: "Restore" })
    await user.click(restore)
    await waitFor(() => expect(restore).toBeDisabled())

    await act(async () => {
      fail(new Error("offline"))
    })

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith("offline"))
    expect(screen.getByRole("dialog", { name: "History" })).toBeInTheDocument()
    await waitFor(() => expect(restore).toBeEnabled())
  })

  it("says when there is no history yet", async () => {
    server.listAutofillNoteVersions.mockResolvedValue([])
    const { user } = renderEditor("")

    const dialog = await openHistory(user)

    expect(
      await within(dialog).findByText("No earlier versions yet.")
    ).toBeInTheDocument()
  })

  it("offers a retry when History does not load", async () => {
    server.listAutofillNoteVersions
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([EARLIER])
    const { user } = renderEditor("")

    const dialog = await openHistory(user)
    expect(
      await within(dialog).findByText("History didn't load.")
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Try again" }))

    expect(
      await within(dialog).findByRole("button", { name: /Before editing/ })
    ).toBeInTheDocument()
  })

  it("offers a retry when a version does not load", async () => {
    server.listAutofillNoteVersions.mockResolvedValue([EARLIER])
    server.getAutofillNoteVersion
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(EARLIER_TEXT)
    const { user } = renderEditor("")

    const dialog = await openHistory(user)
    await user.click(
      await within(dialog).findByRole("button", { name: /Before editing/ })
    )
    expect(
      await within(dialog).findByText("This version didn't load.")
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Try again" }))

    expect(await within(dialog).findByText("- Old fact")).toBeInTheDocument()
  })

  it("says when a version has no text", async () => {
    server.listAutofillNoteVersions.mockResolvedValue([
      { ...EARLIER, length: 0 },
    ])
    server.getAutofillNoteVersion.mockResolvedValue({
      ...EARLIER_TEXT,
      content: "",
    })
    const { user } = renderEditor("- Prefers remote work")

    const dialog = await openHistory(user)
    const empty = await within(dialog).findByRole("button", {
      name: /Before editing/,
    })
    expect(empty).toHaveTextContent("0 characters")
    await user.click(empty)

    expect(
      await within(dialog).findByText("This version has no text.")
    ).toBeInTheDocument()
  })
})
