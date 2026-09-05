import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { EndDateInput, MonthInput, TextInput } from "./fields"

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

function LiveEndDateField() {
  const [value, setValue] = useState("present")
  return (
    <EndDateInput
      label="End"
      value={value}
      onCommit={setValue}
      error={value ? undefined : "End date is required"}
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
  it("renders the current month and opens the calendar", async () => {
    const user = userEvent.setup()
    render(<LiveMonthField />)

    const trigger = screen.getByLabelText("Start")
    expect(trigger).toHaveTextContent("Jan 2020")

    await user.click(trigger)
    expect(await screen.findByRole("grid")).toBeInTheDocument()
  })

  it("commits the month of the picked day", async () => {
    const user = userEvent.setup()
    const commits: string[] = []
    render(
      <MonthInput label="Start" value="" onCommit={(v) => commits.push(v)} />
    )

    await user.click(screen.getByLabelText("Start"))
    const grid = await screen.findByRole("grid")
    const day = grid.querySelector("button")
    if (!day) throw new Error("calendar has no day buttons")
    await user.click(day)

    expect(commits).toHaveLength(1)
    expect(commits[0]).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
  })
})

describe("EndDateInput", () => {
  it("holds the required error until the Present toggle is left", async () => {
    const user = userEvent.setup()
    render(<LiveEndDateField />)

    const checkbox = screen.getByRole("checkbox", { name: "Present" })
    expect(checkbox).toBeChecked()

    // Unticking Present hands the month picker an empty value, the start of
    // an edit rather than a mistake to report mid-change.
    await user.click(checkbox)
    expect(screen.queryByText("End date is required")).not.toBeInTheDocument()

    await user.tab()
    expect(screen.getByText("End date is required")).toBeInTheDocument()
  })
})
