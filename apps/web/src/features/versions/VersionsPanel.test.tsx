import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { defaultTemplateOptions, type Resume } from "@workspace/resume-schema"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { ResumeRecord } from "@/lib/types"

const listVersions = vi.fn()
const getVersion = vi.fn()
const restoreVersion = vi.fn()

vi.mock("@/lib/api", () => ({
  listVersions: (...args: unknown[]) => listVersions(...args),
  getVersion: (...args: unknown[]) => getVersion(...args),
  restoreVersion: (...args: unknown[]) => restoreVersion(...args),
  updateResume: vi.fn(async () => ({
    revision: 2,
    updatedAt: new Date().toISOString(),
  })),
  setTemplate: vi.fn(async () => undefined),
}))

import { ResumeSessionProvider } from "../resume/session-context"
import { VersionsPanel } from "./VersionsPanel"

/**
 * The panel now lives in the editor's middle column instead of a full-width
 * screen, so the diff has to open under the version it belongs to rather than
 * in a second column that column is too narrow to hold.
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
          company: "Globex",
          role: "Engineer",
          start: "2020-01",
          end: "present",
          bullets: [
            { id: "bul_aaaaaaaaaa", text: "Shipped 3 things" },
            { id: "bul_bbbbbbbbbb", text: "Cut latency by 40%" },
          ],
        },
      ],
    },
  ],
}

/** The same resume before the company was renamed, so the diff is non-empty. */
const older: Resume = structuredClone(doc)
const olderItem = older.sections[0]?.items[0]
if (olderItem && olderItem.kind === "experience") olderItem.company = "Acme"

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

function renderPanel(content: Resume = older) {
  listVersions.mockResolvedValue([
    {
      id: "ver_2",
      versionNo: 2,
      label: "Tightened the summary",
      createdBy: "user",
      createdAt: new Date().toISOString(),
    },
    {
      id: "ver_1",
      versionNo: 1,
      label: "First draft",
      createdBy: "system",
      createdAt: new Date().toISOString(),
    },
  ])
  getVersion.mockResolvedValue({
    id: "ver_1",
    versionNo: 1,
    label: "First draft",
    createdBy: "system",
    createdAt: new Date().toISOString(),
    resumeId: "res_1",
    contentHash: "abc",
    content,
  })

  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ResumeSessionProvider
        record={{ ...record, data: structuredClone(doc) }}
        conversationId="con_1"
      >
        <VersionsPanel />
      </ResumeSessionProvider>
    </QueryClientProvider>
  )
}

describe("the versions panel", () => {
  it("lists the versions under a Versions heading", async () => {
    renderPanel()

    expect(
      await screen.findByRole("heading", { name: "Versions" })
    ).toBeInTheDocument()
    expect(await screen.findByText("First draft")).toBeInTheDocument()
  })

  it("shows no diff until a version is picked", async () => {
    renderPanel()
    await screen.findByText("First draft")

    expect(
      screen.queryByRole("button", { name: /restore/i })
    ).not.toBeInTheDocument()
  })

  it("opens the diff underneath the version that was picked", async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByText("First draft"))

    const restore = await screen.findByRole("button", { name: /restore/i })
    const row = restore.closest("li")
    expect(row).not.toBeNull()
    expect(row).toHaveTextContent("First draft")
    expect(await screen.findByText(/1 change since/i)).toBeInTheDocument()
  })

  it("closes the diff when the same version is picked again", async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByText("First draft"))
    await screen.findByRole("button", { name: /restore/i })
    await user.click(screen.getByText("First draft"))

    expect(
      screen.queryByRole("button", { name: /restore/i })
    ).not.toBeInTheDocument()
  })

  it("says what a changed field went from and to", async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(await screen.findByText("First draft"))

    expect(await screen.findByText("company")).toBeInTheDocument()
    expect(screen.getByText("Acme")).toBeInTheDocument()
    expect(screen.getByText("Globex")).toBeInTheDocument()
  })

  it("shows the content an addition brought in", async () => {
    const user = userEvent.setup()
    const without = structuredClone(doc)
    const item = without.sections[0]?.items[0]
    if (!item || item.kind === "skills") throw new Error("bad fixture")
    item.bullets = item.bullets.slice(0, 1)
    renderPanel(without)

    await user.click(await screen.findByText("First draft"))

    expect(await screen.findByText("Cut latency by 40%")).toBeInTheDocument()
  })

  it("shows the content a removal took away", async () => {
    const user = userEvent.setup()
    const extra = structuredClone(doc)
    const item = extra.sections[0]?.items[0]
    if (!item || item.kind === "skills") throw new Error("bad fixture")
    item.bullets.push({ id: "bul_cccccccccc", text: "Ran the on-call rota" })
    renderPanel(extra)

    await user.click(await screen.findByText("First draft"))

    expect(await screen.findByText("Ran the on-call rota")).toBeInTheDocument()
  })

  it("says where a reordered entry moved to", async () => {
    const user = userEvent.setup()
    const swapped = structuredClone(doc)
    const item = swapped.sections[0]?.items[0]
    if (!item || item.kind === "skills") throw new Error("bad fixture")
    item.bullets.reverse()
    renderPanel(swapped)

    await user.click(await screen.findByText("First draft"))

    expect(await screen.findByText(/position 2 to 1/i)).toBeInTheDocument()
  })

  it("restores the picked version", async () => {
    const user = userEvent.setup()
    restoreVersion.mockResolvedValue({
      head: older,
      revision: 2,
      updatedAt: new Date().toISOString(),
      version: { id: "ver_3", versionNo: 3, label: "Restored v1" },
    })
    renderPanel()

    await user.click(await screen.findByText("First draft"))
    await user.click(await screen.findByRole("button", { name: /restore/i }))

    expect(restoreVersion).toHaveBeenCalledWith({
      resumeId: "res_1",
      versionId: "ver_1",
    })
  })
})
