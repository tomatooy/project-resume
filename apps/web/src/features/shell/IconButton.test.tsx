import { render, screen } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it } from "vitest"

import { IconButton } from "./IconButton"

/**
 * What the shared control owns beyond the Button it wraps: the tooltip text and
 * the accessible name are one string, and a ref put on it still reaches the DOM
 * node, which the rail's search uses to take focus back when the field closes.
 */
describe("IconButton", () => {
  it("names the button after its label", () => {
    render(<IconButton label="Search resumes" />)

    expect(
      screen.getByRole("button", { name: "Search resumes" })
    ).toBeInTheDocument()
  })

  it("passes a ref through to the button it renders", () => {
    const ref = createRef<HTMLButtonElement>()
    render(<IconButton ref={ref} label="Clear search" />)

    expect(ref.current).toBe(
      screen.getByRole("button", { name: "Clear search" })
    )
  })
})
