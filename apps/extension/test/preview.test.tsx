import { beforeEach, afterEach, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { defaultTemplateOptions } from "@workspace/resume-schema"
import type { ResumePreview } from "@workspace/resume-core/contracts"
import type { PdfViewerProps } from "@workspace/resume-preview/viewer"
import { TailoredPreview } from "../src/panel/preview/TailoredPreview"
import { ExtensionError, type PreviewRequest } from "../src/lib/messages"

const mock = vi.hoisted(() => ({
  fetch: vi.fn(),
  render: vi.fn(),
  download: vi.fn(),
}))
vi.mock("../src/lib/messages", async (original) => ({
  ...(await original<typeof import("../src/lib/messages")>()),
  sendResumePreview: mock.fetch,
}))
vi.mock("@workspace/resume-preview/render", () => ({
  renderPreview: mock.render,
}))
vi.mock("@workspace/resume-preview", async (original) => ({
  ...(await original<typeof import("@workspace/resume-preview")>()),
  downloadBlob: mock.download,
}))
vi.mock("@workspace/resume-preview/viewer", () => ({
  PdfViewer: ({ blob, zoom, onReady, onError }: PdfViewerProps) => (
    <div>
      <span>PDF at {zoom}%</span>
      <button type="button" onClick={() => blob && onReady?.(blob, 2)}>
        Finish displaying PDF
      </button>
      <button type="button" onClick={() => blob && onError?.(blob)}>
        Fail PDF display
      </button>
    </div>
  ),
}))

const id = "00000000-0000-4000-8000-000000000001"
const request: PreviewRequest = {
  accountId: id,
  resumeId: id,
  operationId: id,
  identity: { platform: "linkedin", externalJobId: "123456" },
}
const resume: ResumePreview = {
  id,
  title: "Product engineer",
  updatedAt: "2026-10-21T12:00:00Z",
  revision: 1,
  data: {
    schemaVersion: 1,
    basics: { id: "basics", name: "Jo Lee", links: [] },
    sections: [],
  },
  templateId: "lisbon",
  templateOptions: defaultTemplateOptions,
}
const blob = new Blob(["resume PDF"])
const clients: QueryClient[] = []

beforeEach(() => {
  mock.fetch.mockResolvedValue(resume)
  mock.render.mockResolvedValue(blob)
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: new DOMRectReadOnly(0, 0, 400, 600),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          this
        )
      }
      unobserve() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  for (const client of clients.splice(0)) client.clear()
  vi.resetAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const actions = { onEdit: vi.fn(), onBack: vi.fn(), onConnect: vi.fn() }
  render(
    <QueryClientProvider client={client}>
      <TailoredPreview request={request} {...actions} editing={false} />
    </QueryClientProvider>
  )
  return actions
}

it("downloads exactly the displayed PDF and supports fit, zoom and editing", async () => {
  const actions = mount()
  await screen.findByText(resume.title)
  const download = screen.getByRole("button", { name: "Download PDF" })
  expect(download.hasAttribute("disabled")).toBe(true)
  fireEvent.click(
    await screen.findByRole("button", { name: "Finish displaying PDF" })
  )
  expect(download.hasAttribute("disabled")).toBe(false)
  expect(screen.getByText("2 pages")).toBeTruthy()
  fireEvent.click(download)
  expect(mock.download).toHaveBeenCalledExactlyOnceWith(
    blob,
    "Productengineer.pdf"
  )
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }))
  expect(screen.getByText("PDF at 125%")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Fit width" }))
  expect(await screen.findByText("PDF at 100%")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Edit in app" }))
  expect(actions.onEdit).toHaveBeenCalledOnce()
})

it("retains the displayed PDF while checking for saved edits and disables download", async () => {
  mount()
  fireEvent.click(
    await screen.findByRole("button", { name: "Finish displaying PDF" })
  )
  mock.fetch.mockReturnValue(new Promise(() => {}))
  fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }))
  await screen.findByText("Checking for saved changes…")
  expect(screen.getByText("PDF at 100%")).toBeTruthy()
  expect(
    screen
      .getByRole("button", { name: "Download PDF" })
      .hasAttribute("disabled")
  ).toBe(true)
})

it("retries a failed render while retaining access to the editor", async () => {
  mock.render.mockRejectedValueOnce(new Error("render failed"))
  const actions = mount()
  await screen.findByText("Could not display the PDF")
  fireEvent.click(screen.getByRole("button", { name: "Edit in app" }))
  expect(actions.onEdit).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole("button", { name: "Try again" }))
  await screen.findByRole("button", { name: "Finish displaying PDF" })
  expect(mock.render).toHaveBeenCalledTimes(2)
})

it("reports a viewer failure separately from tailoring and offers a retry", async () => {
  mount()
  fireEvent.click(
    await screen.findByRole("button", { name: "Fail PDF display" })
  )
  await screen.findByText("Could not display the PDF")
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  expect(screen.queryByText("Could not finish tailoring")).toBeNull()
})

it("reconnects for authentication errors without displaying cached documents", async () => {
  mock.fetch.mockRejectedValue(
    new ExtensionError("Connect your account again.", "auth")
  )
  const actions = mount()
  fireEvent.click(
    await screen.findByRole("button", { name: "Connect account" })
  )
  expect(actions.onConnect).toHaveBeenCalledOnce()
  expect(mock.render).not.toHaveBeenCalled()
})

it("expands on request, restores width on Escape and returns focus to the caller", async () => {
  mock.fetch.mockReturnValue(new Promise(() => {}))
  const post = vi.spyOn(window.parent, "postMessage")
  const actions = mount()
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Back" })
  )
  fireEvent.click(screen.getByRole("button", { name: "Expand preview" }))
  await waitFor(() =>
    expect(post).toHaveBeenLastCalledWith(
      { type: "panel-resize", expanded: true },
      "*"
    )
  )
  fireEvent.keyDown(document, { key: "Escape" })
  expect(post).toHaveBeenLastCalledWith(
    { type: "panel-resize", expanded: false },
    "*"
  )
  expect(actions.onBack).not.toHaveBeenCalled()
  fireEvent.keyDown(document, { key: "Escape" })
  expect(actions.onBack).toHaveBeenCalledOnce()
})
