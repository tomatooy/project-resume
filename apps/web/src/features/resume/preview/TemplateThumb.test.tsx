import { templates } from "@workspace/resume-render"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { TemplateThumb } from "./TemplateThumb"

/**
 * The schematic is the placeholder, not a fallback nobody sees: the picker
 * draws it on every card the moment it opens and swaps in each render as it
 * lands, so both branches are on screen in the same second.
 */
describe("TemplateThumb", () => {
  it("draws the schematic until a render arrives", () => {
    const { container } = render(<TemplateThumb template={templates.lisbon} />)

    expect(container.querySelector("img")).toBeNull()
  })

  it("shows the rendered page once there is one", () => {
    render(
      <TemplateThumb
        template={templates.lisbon}
        src="data:image/png;base64,AAA"
      />
    )

    expect(screen.getByRole("presentation")).toHaveAttribute(
      "src",
      "data:image/png;base64,AAA"
    )
  })
})
