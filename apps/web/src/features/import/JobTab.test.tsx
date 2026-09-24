import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ResumeSummary } from "@/lib/types"

const listResumes = vi.fn()
const tailorFromJob = vi.fn()
const fetchJobPosting = vi.fn()

vi.mock("@/lib/api", () => ({
  listResumes: (...args: unknown[]) => listResumes(...args),
  tailorFromJob: (...args: unknown[]) => tailorFromJob(...args),
  fetchJobPosting: (...args: unknown[]) => fetchJobPosting(...args),
}))

import { JobTab } from "./JobTab"

const KEY = "resume-studio.tailor-source"

/** The posting floor the tab applies before the button unlocks. */
const MIN_TEXT = 200

function summary(id: string, title: string): ResumeSummary {
  return {
    id,
    title,
    subtitle: "",
    templateId: "lisbon",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function renderTab(
  props: { sourceResumeId?: string; onDone?: () => void } = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <JobTab
        onDone={props.onDone ?? (() => {})}
        sourceResumeId={props.sourceResumeId}
      />
    </QueryClientProvider>
  )
}

/** The base resume the trigger is showing, which is what the dialog will send.
 *  A substring match, because the trigger also holds the caret glyph. */
async function expectBase(label: string): Promise<void> {
  const trigger = await screen.findByRole("combobox")
  await waitFor(() => expect(trigger).toHaveTextContent(label))
}

beforeEach(() => {
  localStorage.clear()
  listResumes.mockResolvedValue([
    summary("a", "Base A"),
    summary("b", "Base B"),
  ])
})

describe("JobTab", () => {
  it("opens on the base resume used last time", async () => {
    localStorage.setItem(KEY, JSON.stringify("b"))

    renderTab()

    await expectBase("Base B")
  })

  it("prefers the resume the dialog was opened from", async () => {
    localStorage.setItem(KEY, JSON.stringify("a"))

    renderTab({ sourceResumeId: "b" })

    await expectBase("Base B")
  })

  it("ignores a remembered resume that is gone", async () => {
    localStorage.setItem(KEY, JSON.stringify("deleted"))

    renderTab()

    await expectBase("Choose a resume")
  })

  it("remembers the base resume picked here", async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(await screen.findByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "Base B" }))

    expect(JSON.parse(localStorage.getItem(KEY) ?? '""')).toBe("b")
  })

  it("leaves the memory alone when it generated from the resume it opened on", async () => {
    const user = userEvent.setup()
    tailorFromJob.mockResolvedValue({ tailored: true })
    renderTab({ sourceResumeId: "b" })

    await user.type(
      await screen.findByLabelText("Job description"),
      "x".repeat(MIN_TEXT)
    )
    await user.click(screen.getByRole("button", { name: "Create resume" }))

    await waitFor(() => expect(tailorFromJob).toHaveBeenCalledOnce())
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
