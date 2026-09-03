import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { MonthInput, TextInput } from "./fields"

/**
 * Mirrors how the editor drives these fields: every keystroke writes straight
 * to the document, and the error is re-derived from that value on each render.
 * The value being briefly empty or half-typed on the way to a good one is
 * therefore normal, and must not be reported as a mistake.
 */
function LiveTextField({ initial = "Acme" }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <TextInput
      label="Company"
      value={value}
      onCommit={setValue}
      error={value.length === 0 ? "Company is required" : undefined}
    />
  )
}

function LiveMonthField() {
  const [value, setValue] = useState("2020-01")
  return (
    <MonthInput
      label="Start"
      value={value}
      onCommit={setValue}
      error={/^\d{4}-\d{2}$/.test(value) ? undefined : "Use the YYYY-MM format"}
    />
  )
}

describe("TextInput", () => {
  it("stays quiet while a required field is being retyped", async () => {
    const user = userEvent.setup()
    render(<LiveTextField />)
    const input = screen.getByLabelText("Company")

    await user.clear(input)

    expect(screen.queryByText("Company is required")).not.toBeInTheDocument()
    expect(input).toHaveAttribute("aria-invalid", "false")
  })

  it("reports the problem once the user leaves the field", async () => {
    const user = userEvent.setup()
    render(<LiveTextField />)
    const input = screen.getByLabelText("Company")

    await user.clear(input)
    await user.tab()

    expect(screen.getByText("Company is required")).toBeInTheDocument()
    expect(input).toHaveAttribute("aria-invalid", "true")
  })

  it("clears the message as soon as a valid value is typed back in", async () => {
    const user = userEvent.setup()
    render(<LiveTextField />)
    const input = screen.getByLabelText("Company")

    await user.clear(input)
    await user.tab()
    await user.type(input, "Acme")
    await user.tab()

    expect(screen.queryByText("Company is required")).not.toBeInTheDocument()
  })

  it("shows a standing error when the field is focused but not yet edited", async () => {
    const user = userEvent.setup()
    render(<LiveTextField initial="" />)
    const input = screen.getByLabelText("Company")

    // The message is what tells the user which field to fix, so entering the
    // field must not make it vanish before they have changed anything.
    expect(screen.getByText("Company is required")).toBeInTheDocument()
    await user.click(input)
    expect(screen.getByText("Company is required")).toBeInTheDocument()

    await user.type(input, "A")
    expect(screen.queryByText("Company is required")).not.toBeInTheDocument()
  })
})

describe("MonthInput", () => {
  it("stays quiet while the month is being cleared and re-picked", async () => {
    const user = userEvent.setup()
    render(<LiveMonthField />)
    const input = screen.getByLabelText("Start")

    await user.clear(input)

    expect(screen.queryByText("Use the YYYY-MM format")).not.toBeInTheDocument()
  })

  it("reports a half-picked month once the user leaves it", async () => {
    const user = userEvent.setup()
    render(<LiveMonthField />)
    const input = screen.getByLabelText("Start")

    await user.clear(input)
    await user.tab()

    expect(screen.getByText("Use the YYYY-MM format")).toBeInTheDocument()
  })
})
