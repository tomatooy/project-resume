import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const deleteUserSkill = vi.fn()
const listSkills = vi.fn()

// The delete's own invalidation reads the library, so the mock has to hold it.
vi.mock("@/lib/api", () => ({
  deleteUserSkill: (...args: unknown[]) => deleteUserSkill(...args),
  listSkills: (...args: unknown[]) => listSkills(...args),
}))

import { DeleteSkillDialog } from "./DeleteSkillDialog"

beforeEach(() => {
  deleteUserSkill.mockReset()
  listSkills.mockReset().mockResolvedValue([])
})

/**
 * The one confirm behind every skill delete: the library row and the tab it is
 * open in both come through here, so what it has to get right is naming the
 * skill, leaving the user a way out, and telling the caller once it is gone.
 */

/** The dialog is driven by its target; the harness closes it like a page does. */
function Harness({ onDeleted }: { onDeleted?: (id: string) => void }) {
  const [open, setOpen] = useState(true)
  return (
    <DeleteSkillDialog
      target={open ? { id: "usr_a", name: "Terse sentences" } : null}
      onClose={() => setOpen(false)}
      onDeleted={onDeleted}
    />
  )
}

function renderDialog(onDeleted?: (id: string) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Harness onDeleted={onDeleted} />
    </QueryClientProvider>
  )
}

describe("DeleteSkillDialog", () => {
  it("names the skill and says what a delete leaves behind", () => {
    renderDialog()

    expect(screen.getByText("Delete “Terse sentences”?")).toBeInTheDocument()
    expect(
      screen.getByText(/Suggestions it already shaped keep its name/)
    ).toBeInTheDocument()
  })

  it("deletes the skill it named and hands the id back", async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()
    deleteUserSkill.mockResolvedValue({ ok: true })
    renderDialog(onDeleted)

    await user.click(screen.getByRole("button", { name: "Delete" }))

    await waitFor(() =>
      expect(deleteUserSkill).toHaveBeenCalledWith({ id: "usr_a" })
    )
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("usr_a"))
  })

  it("deletes nothing when the user backs out", async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole("button", { name: "Cancel" }))

    expect(deleteUserSkill).not.toHaveBeenCalled()
    expect(
      screen.queryByText("Delete “Terse sentences”?")
    ).not.toBeInTheDocument()
  })
})
