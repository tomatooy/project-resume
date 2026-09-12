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

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ resumeId: "res_1" }),
  useNavigate: () => () => {},
  useMatchRoute: () => () => false,
}))

import { ResumeTree } from "./ResumeTree"
import { ResumeSessionProvider, useResumeState } from "./session-context"
import { ResumeWorkspaceProvider, useResumeWorkspace } from "./workspace"

/**
 * The tree is the only way to reach a section now that the section rail is
 * gone, so what it has to get right is that every section of the open document
 * is in it and that a click opens that section's pane.
 */

const SECTION_ID = "sec_aaaaaaaaaa"

const doc: Resume = {
  schemaVersion: 1,
  basics: { id: "basics", name: "Jo Rivera", links: [] },
  sections: [
    {
      id: SECTION_ID,
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
          bullets: [
            { id: "bul_aaaaaaaaaa", text: "Led the migration" },
            { id: "bul_bbbbbbbbbb", text: "Cut latency 40%" },
          ],
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

/** Stands in for the editor: reports the open pane and the live section ids. */
function PaneProbe() {
  const { pane } = useResumeWorkspace()
  const ids = useResumeState((s) => s.doc.sections.map((s) => s.id).join(" "))
  return <span data-testid="pane">{`pane=${pane} ids=${ids}`}</span>
}

function renderTree() {
  return render(
    <ResumeSessionProvider
      record={{ ...record, data: structuredClone(doc) }}
      conversationId="con_1"
    >
      <ResumeWorkspaceProvider>
        <ResumeTree />
        <PaneProbe />
      </ResumeWorkspaceProvider>
    </ResumeSessionProvider>
  )
}

function paneText(): string {
  return screen.getByTestId("pane").textContent ?? ""
}

describe("the resume tree", () => {
  it("lists the fixed parts and every section of the open document", () => {
    renderTree()

    expect(screen.getByRole("button", { name: "Contact" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Summary" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /^Experience/ })
    ).toBeInTheDocument()
  })

  it("marks the section it opened and counts the bullets that lack a number", async () => {
    const user = userEvent.setup()
    renderTree()

    await user.click(screen.getByRole("button", { name: /^Experience/ }))

    expect(paneText()).toContain(`pane=${SECTION_ID}`)
    // One of the two bullets states no figure, so the row shows the count.
    expect(
      screen.getByRole("button", { name: /^Experience/ })
    ).toHaveTextContent(/^Experience\s*1$/)
  })

  it("goes back to Contact when the fixed part is clicked", async () => {
    const user = userEvent.setup()
    renderTree()

    await user.click(screen.getByRole("button", { name: /^Experience/ }))
    await user.click(screen.getByRole("button", { name: "Contact" }))

    expect(paneText()).toContain("pane=contact")
  })

  it("adds a section and opens the new pane", async () => {
    const user = userEvent.setup()
    renderTree()

    await user.click(screen.getByRole("button", { name: /add section/i }))
    await user.click(await screen.findByRole("menuitem", { name: "Education" }))

    const ids = paneText().split("ids=")[1].split(" ")
    expect(ids).toHaveLength(2)
    expect(paneText()).toContain(`pane=${ids[1]}`)
  })

  it("falls back to Contact when the open section is deleted", async () => {
    const user = userEvent.setup()
    renderTree()

    await user.click(screen.getByRole("button", { name: /^Experience/ }))
    await user.click(screen.getByLabelText("Actions for Experience"))
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }))

    expect(paneText()).toContain("pane=contact")
    expect(
      screen.queryByRole("button", { name: /^Experience/ })
    ).not.toBeInTheDocument()
  })
})
