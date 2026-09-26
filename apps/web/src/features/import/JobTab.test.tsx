import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ResumeSummary } from "@/lib/types"

const listResumes = vi.fn()
const tailorFromJob = vi.fn()
const fetchJobPosting = vi.fn()

vi.mock("@/lib/api", () => ({
  listResumePage: async () => ({
    items: await listResumes(),
    nextCursor: null,
    total: 2,
  }),
  getResumeSummary: async ({ id }: { id: string }) => {
    const row = (await listResumes()).find(
      (row: ResumeSummary) => row.id === id
    )
    if (!row) throw new Error("Not found")
    return row
  },
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
  vi.clearAllMocks()
  localStorage.clear()
  listResumes.mockResolvedValue([
    summary("a", "Base A"),
    summary("b", "Base B"),
  ])
})

describe("JobTab", () => {
  it("submits the fetched description and this tailoring's additional instruction", async () => {
    const url = "https://www.linkedin.com/jobs/view/123456/"
    fetchJobPosting.mockResolvedValue({
      url,
      text: "x".repeat(MIN_TEXT),
    })
    tailorFromJob.mockResolvedValue({ tailored: true })
    renderTab({ sourceResumeId: "b" })
    fireEvent.change(await screen.findByLabelText("LinkedIn job link"), {
      target: { value: url },
    })
    fireEvent.click(screen.getByRole("button", { name: "Fetch" }))
    await waitFor(() =>
      expect(screen.getByLabelText("Job description")).toHaveValue(
        "x".repeat(MIN_TEXT)
      )
    )
    fireEvent.change(screen.getByLabelText(/Additional instruction/), {
      target: { value: "Keep my research projects." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create resume" }))
    await waitFor(() =>
      expect(tailorFromJob).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceUrl: url,
          additionalInstruction: "Keep my research projects.",
        }),
        expect.any(AbortSignal)
      )
    )
  })

  it("discards a fetch response after the job URL changes", async () => {
    let finish: ((value: { url: string; text: string }) => void) | undefined
    fetchJobPosting.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    renderTab({ sourceResumeId: "b" })
    const input = await screen.findByLabelText("LinkedIn job link")
    fireEvent.change(input, {
      target: { value: "https://www.linkedin.com/jobs/view/123456/" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Fetch" }))
    fireEvent.change(input, {
      target: { value: "https://www.linkedin.com/jobs/view/654321/" },
    })
    await act(async () =>
      finish?.({
        url: "https://www.linkedin.com/jobs/view/123456/",
        text: "x".repeat(MIN_TEXT),
      })
    )
    expect(screen.getByLabelText("Job description")).toHaveValue("")
    expect(screen.queryByRole("link", { name: /Application page/ })).toBeNull()
  })

  it("requires a fresh description before associating a fetched posting with another URL", async () => {
    const url = "https://www.linkedin.com/jobs/view/123456/"
    fetchJobPosting.mockResolvedValue({
      url,
      text: "x".repeat(MIN_TEXT),
    })
    tailorFromJob.mockResolvedValue({ tailored: true })
    renderTab({ sourceResumeId: "b" })
    const input = await screen.findByLabelText("LinkedIn job link")
    fireEvent.change(input, { target: { value: url } })
    fireEvent.click(screen.getByRole("button", { name: "Fetch" }))
    await waitFor(() =>
      expect(screen.getByLabelText("Job description")).toHaveValue(
        "x".repeat(MIN_TEXT)
      )
    )
    fireEvent.change(input, {
      target: { value: "https://www.linkedin.com/jobs/view/654321/" },
    })
    expect(screen.getByRole("button", { name: "Create resume" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Job description"), {
      target: { value: "New description ".repeat(30) },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create resume" }))
    await waitFor(() =>
      expect(tailorFromJob).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceUrl: "https://www.linkedin.com/jobs/view/654321/",
        }),
        expect.any(AbortSignal)
      )
    )
  })
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
