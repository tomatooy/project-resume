import { defaultTemplateOptions, type Resume } from "@workspace/resume-schema"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { ResumeRecord } from "@/lib/types"

vi.mock("@/lib/api", () => ({
  updateResume: vi.fn(async () => ({
    revision: 2,
    updatedAt: new Date().toISOString(),
  })),
  setTemplate: vi.fn(async () => undefined),
}))

import { ResumeSessionProvider, useResumeState } from "../session-context"
import { ItemCard } from "./ItemCard"

/**
 * The whole editing path in one place: a keystroke goes through the field, the
 * action, the patch engine and the store, and has to come back out as the
 * character the user typed. Testing the pieces separately missed that the
 * document silently refused edits, which the user sees as the box putting the
 * old text straight back.
 */

const EXP_ID = "exp_aaaaaaaaaa"

const doc: Resume = {
  schemaVersion: 1,
  basics: { id: "basics", name: "Jo Rivera", links: [] },
  sections: [
    {
      id: "sec_aaaaaaaaaa",
      type: "experience",
      title: "Experience",
      items: [
        {
          id: EXP_ID,
          kind: "experience",
          company: "Acme",
          role: "Engineer",
          start: "2020-01",
          end: "present",
          bullets: [{ id: "bul_aaaaaaaaaa", text: "Shipped 3 things" }],
        },
      ],
    },
  ],
}

const record: ResumeRecord = {
  id: "res_1",
  title: "Test",
  subtitle: "",
  templateId: "lisbon",
  updatedAt: new Date().toISOString(),
  data: structuredClone(doc),
  schemaVersion: 1,
  templateOptions: defaultTemplateOptions,
  currentVersionId: null,
  revision: 1,
}

/** Reads the item back out of the store, as `SectionPane` does in the app. */
function LiveCard() {
  const item = useResumeState((s) => s.doc.sections[0]?.items[0])
  if (!item) throw new Error("lost the item")
  return <ItemCard item={item} open onToggle={() => {}} handle={null} />
}

function renderCard() {
  return render(
    <ResumeSessionProvider
      record={{ ...record, data: structuredClone(doc) }}
      conversationId="con_1"
    >
      <LiveCard />
    </ResumeSessionProvider>
  )
}

describe("editing an experience card", () => {
  it("lets a required field be cleared and retyped", async () => {
    const user = userEvent.setup()
    renderCard()
    const company = screen.getByLabelText<HTMLInputElement>("Company")

    await user.clear(company)
    expect(company).toHaveValue("")

    await user.type(company, "Globex")
    expect(company).toHaveValue("Globex")
  })

  it("does not report a problem while the field is being retyped", async () => {
    const user = userEvent.setup()
    renderCard()
    const company = screen.getByLabelText("Company")

    await user.clear(company)

    expect(screen.queryByText(/expected string/i)).not.toBeInTheDocument()
    expect(company).toHaveAttribute("aria-invalid", "false")
  })

  it("reports the empty field once the user moves on", async () => {
    const user = userEvent.setup()
    renderCard()
    const company = screen.getByLabelText("Company")

    await user.clear(company)
    await user.tab()

    expect(company).toHaveAttribute("aria-invalid", "true")
  })

  it("accepts typing into an optional field that was never filled in", async () => {
    const user = userEvent.setup()
    renderCard()
    const location = screen.getByLabelText<HTMLInputElement>("Location")

    expect(location).toHaveValue("")
    await user.type(location, "Berlin")

    expect(location).toHaveValue("Berlin")
  })

  // The start is a month picker, not a text box: it opens a calendar and
  // commits the month of whatever day is chosen. What this still checks is
  // the whole path the old typing test checked: the pick goes through the
  // field, the action, the patch engine and the store, and comes back out on
  // the control.
  it("lets the start month be re-picked from the picker", async () => {
    const user = userEvent.setup()
    renderCard()
    const start = screen.getByLabelText("Start")
    expect(start).toHaveTextContent("Jan 2020")

    await user.click(start)

    // The calendar's caption is two transparent dropdowns, month then year.
    // The month options are 0-based, as react-day-picker numbers them.
    const [monthSelect] = screen.getAllByRole("combobox")
    if (!monthSelect) throw new Error("the picker has no month dropdown")
    await user.selectOptions(monthSelect, "5")

    const day = screen.getByText("15", { selector: "button" })
    await user.click(day)

    expect(start).toHaveTextContent("Jun 2020")
  })
})
