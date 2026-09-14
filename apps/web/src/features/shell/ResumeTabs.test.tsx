import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

/** Which route the stubbed matcher calls open. Each test sets its own. */
const router = vi.hoisted(() => ({ active: "/r/$resumeId/edit" }))

vi.mock("@tanstack/react-router", () => ({
  useMatchRoute: () => (options: { to: string }) =>
    options.to === router.active,
  // The real Link resolves the route tree; the href is all these tests read.
  Link: ({
    to,
    params,
    children,
    ...rest
  }: ComponentProps<"a"> & { to: string; params?: { resumeId: string } }) => (
    <a href={to.replace("$resumeId", params?.resumeId ?? "")} {...rest}>
      {children}
    </a>
  ),
}))

import { ResumeTabs } from "./ResumeTabs"

/**
 * The strip is the only view switch now, so what it has to get right is that
 * every screen is on it, in one order, pointing at the resume that is open,
 * and that exactly one of them is marked as current.
 */

const RESUME_ID = "res_1"

function renderTabs({ fullWidth = false }: { fullWidth?: boolean } = {}) {
  const onToggleFullWidth = vi.fn()
  render(
    <ResumeTabs
      resumeId={RESUME_ID}
      fullWidth={fullWidth}
      onToggleFullWidth={onToggleFullWidth}
    />
  )
  return { onToggleFullWidth }
}

describe("ResumeTabs", () => {
  it("lists the four screens in the order they are shown", () => {
    renderTabs()

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      ["Editor", "Versions", "Export", "Interview"]
    )
  })

  it("marks the open screen as current, and only that one", () => {
    router.active = "/r/$resumeId/versions"
    renderTabs()

    expect(screen.getByRole("link", { name: "Versions" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    for (const label of ["Editor", "Export", "Interview"]) {
      expect(screen.getByRole("link", { name: label })).not.toHaveAttribute(
        "aria-current"
      )
    }
  })

  it("falls back to Editor when no screen matches", () => {
    router.active = "/dashboard"
    renderTabs()

    expect(screen.getByRole("link", { name: "Editor" })).toHaveAttribute(
      "aria-current",
      "page"
    )
  })

  it("points every screen at the open resume", () => {
    renderTabs()

    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href"))
    ).toEqual([
      `/r/${RESUME_ID}/edit`,
      `/r/${RESUME_ID}/versions`,
      `/r/${RESUME_ID}/export`,
      `/r/${RESUME_ID}/interview`,
    ])
  })

  it("hands the middle column the row when the switch is used", async () => {
    const user = userEvent.setup()
    const { onToggleFullWidth } = renderTabs()

    await user.click(screen.getByRole("button", { name: "Full width" }))
    expect(onToggleFullWidth).toHaveBeenCalledTimes(1)
  })

  it("asks to restore the side panels once the column has the row", () => {
    renderTabs({ fullWidth: true })

    expect(
      screen.getByRole("button", { name: "Restore the side panels" })
    ).toHaveAttribute("aria-pressed", "true")
    expect(
      screen.queryByRole("button", { name: "Full width" })
    ).not.toBeInTheDocument()
  })
})
