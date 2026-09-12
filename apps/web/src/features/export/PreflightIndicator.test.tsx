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

/**
 * The PDF engine is a browser-only lazy module, and the page count is the one
 * check that needs it. The rest of the state stays real: the store's own
 * defaults, selected the way the app selects them.
 */
vi.mock("../resume/preview/preview-context", async () => {
  const { useStore } = await import("@tanstack/react-store")
  const { createPreviewStore } = await import("../resume/preview/preview-store")
  const store = createPreviewStore()
  store.setState((state) => ({ ...state, pageCount: 1 }))
  return { usePreview: useStore.bind(null, store) }
})

import { ResumeSessionProvider } from "../resume/session-context"
import { PreflightIndicator } from "./PreflightIndicator"

/**
 * The status bar control has to do three things the Export panel does not: fit
 * in 24px, always show a count, and open the same list. Only the last can be
 * checked without eyes, so it is: the trigger carries the count in its label
 * and a click has to put the checks on screen.
 */

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
          id: "exp_aaaaaaaaaa",
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

function renderIndicator() {
  return render(
    <ResumeSessionProvider record={record} conversationId="conv_1">
      <PreflightIndicator />
    </ResumeSessionProvider>
  )
}

describe("PreflightIndicator", () => {
  it("carries the warning count on the trigger", () => {
    renderIndicator()

    // One warning on this document: no email address.
    const trigger = screen.getByRole("button", {
      name: "Preflight: 1 warning",
    })
    expect(trigger).toHaveTextContent("1")
  })

  it("opens the same checks the Export panel lists", async () => {
    const user = userEvent.setup()
    renderIndicator()

    await user.click(
      screen.getByRole("button", { name: "Preflight: 1 warning" })
    )

    expect(await screen.findByText("No email address")).toBeInTheDocument()
    expect(screen.getByText("Single-column layout")).toBeInTheDocument()
    expect(
      screen.getByText("Every bullet carries a figure")
    ).toBeInTheDocument()
  })
})
