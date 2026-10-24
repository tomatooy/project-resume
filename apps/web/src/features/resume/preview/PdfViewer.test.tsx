import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { PdfViewer } from "@workspace/resume-preview/viewer"

vi.mock("@workspace/resume-preview/pdfjs", () => ({ setPdfWorker: vi.fn() }))
vi.mock("react-pdf", async () => {
  const { createContext, use } = await import("react")
  const File = createContext<Blob | null>(null)
  return {
    Document: ({
      file,
      children,
      onLoadSuccess,
      onLoadError,
    }: {
      file: Blob
      children: ReactNode
      onLoadSuccess: (result: { numPages: number }) => void
      onLoadError: () => void
    }) => (
      <File value={file}>
        <div data-testid={`document-${file.size}`}>
          <button
            type="button"
            data-testid={`load-${file.size}`}
            onClick={() => onLoadSuccess({ numPages: 2 })}
          >
            Load PDF
          </button>
          <button
            type="button"
            data-testid={`error-${file.size}`}
            onClick={onLoadError}
          >
            Fail loading PDF
          </button>
          {children}
        </div>
      </File>
    ),
    Page: ({
      pageNumber,
      onRenderSuccess,
    }: {
      pageNumber: number
      onRenderSuccess: () => void
    }) => {
      const file = use(File)
      return (
        <button
          type="button"
          data-testid={`paint-${file?.size}-${pageNumber}`}
          onClick={onRenderSuccess}
        >
          Paint page {pageNumber}
        </button>
      )
    },
  }
})
afterEach(cleanup)

it("keeps the displayed PDF until every page of its replacement has painted", async () => {
  const first = new Blob(["first"])
  const next = new Blob(["replacement"])
  const ready = vi.fn()
  const view = render(
    <PdfViewer blob={first} baseWidth={400} zoom={100} onReady={ready} />
  )
  fireEvent.click(await screen.findByTestId(`load-${first.size}`))
  fireEvent.click(screen.getByTestId(`paint-${first.size}-1`))
  expect(ready).not.toHaveBeenCalled()
  fireEvent.click(screen.getByTestId(`paint-${first.size}-2`))
  expect(ready).toHaveBeenLastCalledWith(first, 2)
  ready.mockClear()

  view.rerender(
    <PdfViewer blob={next} baseWidth={400} zoom={100} onReady={ready} />
  )
  fireEvent.click(await screen.findByTestId(`load-${next.size}`))
  fireEvent.click(screen.getByTestId(`paint-${next.size}-1`))
  expect(
    screen.getByTestId(`document-${first.size}`).closest("[aria-hidden]")
  ).toHaveAttribute("aria-hidden", "false")
  expect(
    screen.getByTestId(`document-${next.size}`).closest("[aria-hidden]")
  ).toHaveAttribute("aria-hidden", "true")
  expect(ready).not.toHaveBeenCalled()

  fireEvent.click(screen.getByTestId(`paint-${next.size}-2`))
  expect(screen.queryByTestId(`document-${first.size}`)).toBeNull()
  expect(
    screen.getByTestId(`document-${next.size}`).closest("[aria-hidden]")
  ).toHaveAttribute("aria-hidden", "false")
  expect(ready).toHaveBeenCalledExactlyOnceWith(next, 2)
})

it("reports the failed document without marking it ready for download", async () => {
  const blob = new Blob(["broken"])
  const ready = vi.fn()
  const failed = vi.fn()
  render(
    <PdfViewer
      blob={blob}
      baseWidth={400}
      zoom={100}
      onReady={ready}
      onError={failed}
    />
  )
  fireEvent.click(await screen.findByTestId(`error-${blob.size}`))
  expect(failed).toHaveBeenCalledExactlyOnceWith(blob)
  expect(ready).not.toHaveBeenCalled()
})
