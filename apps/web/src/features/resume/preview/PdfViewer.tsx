import { useCallback, useEffect, useRef, useState } from "react"
import { Document, Page } from "react-pdf"

import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"

import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import { setPdfWorker } from "./pdfjs"

// Must run after the react-pdf import above, whose module body overwrites
// `workerSrc` with a bare specifier the browser cannot resolve. The worker
// ships with pdfjs-dist, which is pinned to the exact version react-pdf
// depends on; a mismatch fails at runtime with an API/Worker version error,
// so keep the pin in package.json.
setPdfWorker()

export type PdfViewerProps = {
  blob: Blob | null
  /** Rendered page width in CSS pixels, before zoom. */
  baseWidth: number
  zoom: number
  onPageCount?: (pages: number) => void
  className?: string
}

type SlotIndex = 0 | 1
type Slots = [Blob | null, Blob | null]

/**
 * Shows the rendered resume, holding the last finished render on screen while
 * the next one loads.
 *
 * The holding is why there are two `<Document>`s. react-pdf resets a Document
 * the instant its `file` prop changes: every page unmounts and the loading
 * message takes their place until the new file is parsed and painted. Pointing
 * one Document at each new blob therefore blanks the pane on every edit, which
 * no amount of care on the render side can prevent. So a new blob is loaded in
 * the off-screen buffer and only swapped to the front once all of its pages
 * have painted, which puts the finished document on screen in the same commit
 * that removes the old one.
 */
export function PdfViewer({
  blob,
  baseWidth,
  zoom,
  onPageCount,
  className,
}: PdfViewerProps) {
  const [{ slots, front }, setBuffers] = useState<{
    slots: Slots
    front: SlotIndex
  }>({ slots: [null, null], front: 0 })

  useEffect(() => {
    if (!blob) return
    setBuffers((state) => {
      if (state.slots[0] === blob || state.slots[1] === blob) return state
      const slots: Slots = [state.slots[0], state.slots[1]]
      // The first document has nothing to hold over, so it goes straight to
      // the front and shows the spinner while it loads. Every later one waits
      // off screen.
      const target =
        state.slots[state.front] === null
          ? state.front
          : ((1 - state.front) as SlotIndex)
      slots[target] = blob
      return { ...state, slots }
    })
  }, [blob])

  const promote = useCallback((index: SlotIndex, painted: Blob) => {
    setBuffers((state) => {
      // Ignore the front buffer repainting itself (a zoom change), and a
      // buffer that finished after a newer blob had already replaced it.
      if (state.front === index || state.slots[index] !== painted) return state
      const slots: Slots = [state.slots[0], state.slots[1]]
      // Release the outgoing document so the spare buffer is not holding a
      // second copy of the file while it waits for the next render.
      slots[state.front] = null
      return { slots, front: index }
    })
  }, [])

  if (!blob) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  const width = Math.round(baseWidth * (zoom / 100))

  return (
    <div className="relative">
      {([0, 1] as const).map((index) => {
        const slotBlob = slots[index]
        if (!slotBlob) return null
        return (
          <PdfBuffer
            key={index}
            index={index}
            blob={slotBlob}
            width={width}
            front={index === front}
            onPainted={promote}
            onPageCount={onPageCount}
            className={className}
          />
        )
      })}
    </div>
  )
}

type PdfBufferProps = {
  index: SlotIndex
  blob: Blob
  width: number
  /** The front buffer is the one on screen; the other renders out of sight. */
  front: boolean
  onPainted: (index: SlotIndex, blob: Blob) => void
  onPageCount?: (pages: number) => void
  className?: string
}

function PdfBuffer({
  index,
  blob,
  width,
  front,
  onPainted,
  onPageCount,
  className,
}: PdfBufferProps) {
  const [pages, setPages] = useState(0)
  const [tracked, setTracked] = useState(blob)
  const painted = useRef(new Set<number>())

  // A newer blob can land in this buffer while it is still loading the last
  // one, which starts the count over. Adjusted during render rather than in an
  // effect so the stale page count is never rendered.
  if (tracked !== blob) {
    setTracked(blob)
    setPages(0)
    painted.current = new Set()
  }

  useEffect(() => {
    if (front && pages > 0) onPageCount?.(pages)
  }, [front, pages, onPageCount])

  // Tracked by page number rather than counted: a zoom while this buffer is
  // still loading repaints a page that already reported, and a count would
  // read those two paints as two finished pages.
  const onPagePainted = (pageNumber: number) => {
    painted.current.add(pageNumber)
    if (pages > 0 && painted.current.size >= pages) onPainted(index, blob)
  }

  return (
    <div
      aria-hidden={!front}
      className={cn(
        !front && "pointer-events-none absolute top-0 left-0 opacity-0"
      )}
    >
      <Document
        file={blob}
        loading={
          front ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : null
        }
        error={
          front ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              This document could not be displayed.
            </p>
          ) : null
        }
        onLoadSuccess={({ numPages }) => setPages(numPages)}
        className={cn("flex flex-col items-center gap-4", className)}
      >
        {Array.from({ length: pages }, (_, i) => i + 1).map((pageNumber) => (
          <Page
            key={pageNumber}
            pageNumber={pageNumber}
            width={width}
            renderTextLayer
            renderAnnotationLayer={false}
            onRenderSuccess={() => onPagePainted(pageNumber)}
            className="overflow-hidden rounded-[3px] border border-border bg-card shadow-[0_10px_30px_-18px] shadow-foreground/30"
          />
        ))}
      </Document>
    </div>
  )
}
