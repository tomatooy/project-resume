import {
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  CaretDownIcon,
  CaretUpIcon,
  DownloadSimpleIcon,
  MinusIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react"
import {
  templateList,
  type FontScale,
  type PageSize,
  type TemplateId,
  type TemplateOptions,
} from "@workspace/resume-render"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import { lazy, Suspense, useCallback, useState } from "react"
import { toast } from "sonner"

import { IconButton } from "@/features/shell/IconButton"
import { PaneTitle } from "@/features/shell/PaneTitle"
import { ClientOnly } from "@/lib/client-only"
import { useThrottledValue } from "@/lib/use-throttled-value"
import { useResumeState, useSession } from "../session-context"
import { downloadPdf } from "./download"
import { usePreview, usePreviewStore } from "./preview-context"
import { clampZoom, ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS } from "./preview-store"
import { TemplateThumb } from "./TemplateThumb"
import { usePinchZoom } from "./use-pinch-zoom"
import { useTemplateThumbs } from "./use-template-thumbs"

const PdfViewer = lazy(() =>
  import("./PdfViewer").then((m) => ({ default: m.PdfViewer }))
)

const PAGE_LABEL: Record<PageSize, string> = {
  LETTER: "Letter · 8.5 × 11 in",
  A4: "A4 · 210 × 297 mm",
}

/** What the page size shrinks to when the toolbar has no room for the size. */
const SHORT_PAGE_LABEL: Record<PageSize, string> = {
  LETTER: "Letter",
  A4: "A4",
}

/** The three scales every template is laid out to survive. */
const FONT_SCALES: FontScale[] = [0.9, 1, 1.1]

const FONT_SCALE_LABEL: Record<FontScale, string> = {
  0.9: "Compact",
  1: "Normal",
  1.1: "Large",
}

/**
 * The font and template pickers wear the same button. Both are text on the
 * toolbar's paper, with the hover and open states carrying the affordance: a
 * bordered button here would compete with the resume the pane is showing. The
 * dropdown's trigger marks itself `data-popup-open` and the panel button sets
 * `aria-expanded`, so the open treatment is spelled once per marker.
 */
const PICKER_CLASS = cn(
  "flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[11.5px] font-semibold text-foreground transition-colors hover:bg-muted",
  "aria-expanded:bg-primary/8 aria-expanded:text-primary-strong",
  "data-popup-open:bg-primary/8 data-popup-open:text-primary-strong"
)

export function PreviewPane({
  compact = false,
  maximized = false,
  onClose,
  onToggleMaximize,
}: {
  compact?: boolean
  maximized?: boolean
  onClose?: () => void
  onToggleMaximize?: () => void
}) {
  const session = useSession()
  const ownerName = useResumeState((s) => s.doc.basics.name)
  const templateId = useResumeState((s) => s.templateId)
  const options = useResumeState((s) => s.templateOptions)
  const store = usePreviewStore()
  const blob = usePreview((s) => s.blob)
  const loading = usePreview((s) => s.loading)
  const zoom = usePreview((s) => s.zoom)
  const pageCount = usePreview((s) => s.pageCount)
  const [menuOpen, setMenuOpen] = useState(false)

  // Every zoom change costs the viewer a fresh pdf.js render, which blanks the
  // page while it runs. A pinch reports tens of events a second, so the pages
  // follow it at a rate they can keep up with while the readout keeps up with
  // the pointer.
  const renderedZoom = useThrottledValue(zoom, 100)
  const pinchRef = usePinchZoom(store, renderedZoom)

  const picked =
    templateList.find((t) => t.id === templateId) ?? templateList[0]

  const setZoom = (next: number) =>
    store.setState((s) => ({ ...s, zoom: clampZoom(next) }))

  const onPageCount = useCallback(
    (pages: number) =>
      store.setState((s) =>
        s.pageCount === pages ? s : { ...s, pageCount: pages }
      ),
    [store]
  )

  const togglePageSize = () =>
    void session.setTemplate(templateId, {
      ...options,
      pageSize: options.pageSize === "LETTER" ? "A4" : "LETTER",
    })

  const setFontScale = (fontScale: FontScale) =>
    void session.setTemplate(templateId, { ...options, fontScale })

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="@container relative flex-none border-b border-border bg-paper">
        {loading ? (
          <span className="absolute inset-x-0 top-0 h-[2px] overflow-hidden">
            <span className="block h-full w-1/3 animate-[preview-scan_1.1s_ease-in-out_infinite] bg-primary/70" />
          </span>
        ) : null}

        {/* One 44px row cannot hold all of this at every pane width, so the
            page-size words and the page count thin out as it narrows. The
            controls themselves always stay. */}
        <div className="flex h-11 items-center gap-2 px-3.5">
          <PaneTitle>Preview</PaneTitle>
          <button
            type="button"
            onClick={togglePageSize}
            className="rounded-md px-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={`Switch page size · ${PAGE_LABEL[options.pageSize]}`}
          >
            <span className="@min-[42rem]:hidden">
              {SHORT_PAGE_LABEL[options.pageSize]}
            </span>
            <span className="hidden @min-[42rem]:inline">
              {PAGE_LABEL[options.pageSize]}
            </span>
          </button>

          {pageCount ? (
            <span className="hidden rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground @min-[32rem]:block">
              {pageCount} {pageCount === 1 ? "page" : "pages"}
            </span>
          ) : null}

          <div className="flex-1" />

          <span className="text-[10px] font-semibold tracking-[0.07em] text-muted-foreground">
            Font:
          </span>
          <FontPicker value={options.fontScale} onChange={setFontScale} />

          <span className="text-[10px] font-semibold tracking-[0.07em] text-muted-foreground">
            Template:
          </span>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            className={PICKER_CLASS}
          >
            {picked.name}
            {menuOpen ? (
              <CaretUpIcon className="size-2.5 opacity-60" />
            ) : (
              <CaretDownIcon className="size-2.5 opacity-60" />
            )}
          </button>

          {/* The download is one more control in the row's right-hand run,
              not a labelled action of its own: the pane is showing a
              document, and everything else here touches that document. */}
          <IconButton
            label="Download the PDF"
            disabled={!blob}
            onClick={() =>
              blob &&
              toast.success(`Downloaded ${downloadPdf(blob, ownerName)}`)
            }
          >
            <DownloadSimpleIcon />
          </IconButton>

          {onToggleMaximize ? (
            <IconButton
              label={maximized ? "Restore preview" : "Maximize preview"}
              onClick={onToggleMaximize}
            >
              {maximized ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}
            </IconButton>
          ) : null}

          {onClose ? (
            <IconButton label="Close preview" onClick={onClose}>
              <XIcon />
            </IconButton>
          ) : null}
        </div>

        {menuOpen ? (
          <TemplateMenu
            selected={templateId}
            options={options}
            onSelect={(id) => {
              void session.setTemplate(id)
              setMenuOpen(false)
            }}
          />
        ) : null}
      </div>

      {/* The viewer, with the zoom that drives it floating at the foot of the
          pane. Zoom is a view setting rather than a document one, and the
          toolbar is for the document. */}
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={pinchRef}
          className={cn(
            "flex min-h-0 flex-1 justify-center overflow-auto",
            compact ? "px-5 pt-5 pb-[64px]" : "px-5 pt-[22px] pb-[76px]"
          )}
        >
          <ClientOnly>
            <Suspense fallback={null}>
              <PdfViewer
                blob={blob}
                baseWidth={420}
                zoom={renderedZoom}
                onPageCount={onPageCount}
              />
            </Suspense>
          </ClientOnly>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-paper px-1.5 py-1 text-muted-foreground shadow-sm">
            <IconButton
              label="Zoom out"
              className="rounded-full"
              disabled={zoom <= ZOOM_MIN}
              onClick={() => setZoom(previousStep(zoom))}
            >
              <MinusIcon />
            </IconButton>
            <span className="w-9 text-center text-[11px] tabular-nums">
              {Math.round(zoom)}%
            </span>
            <IconButton
              label="Zoom in"
              className="rounded-full"
              disabled={zoom >= ZOOM_MAX}
              onClick={() => setZoom(nextStep(zoom))}
            >
              <PlusIcon />
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  )
}

function FontPicker({
  value,
  onChange,
}: {
  value: FontScale
  onChange: (scale: FontScale) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Font: ${FONT_SCALE_LABEL[value]}`}
            className={PICKER_CLASS}
          />
        }
      >
        {FONT_SCALE_LABEL[value]}
        <CaretDownIcon className="size-2.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {FONT_SCALES.map((scale) => (
            <DropdownMenuRadioItem
              key={scale}
              value={scale}
              closeOnClick
              className="text-[12.5px]"
            >
              {FONT_SCALE_LABEL[scale]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TemplateMenu({
  selected,
  options,
  onSelect,
}: {
  selected: TemplateId
  options: TemplateOptions
  onSelect: (id: TemplateId) => void
}) {
  const session = useSession()
  const thumbs = useTemplateThumbs({
    // Read rather than subscribed. The picker freezes its inputs at open, so a
    // subscription would re-render this menu on every keystroke to hand the
    // hook a document it has already decided to ignore.
    resume: session.store.state.doc,
    options,
    selected,
  })

  return (
    <div className="border-t border-border bg-canvas px-3.5 pt-3 pb-3.5">
      <span className="text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        Switch template
      </span>
      <div className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-[9px]">
        {templateList.map((template) => {
          const active = template.id === selected
          return (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelect(template.id)}
              title={template.description}
              className={cn(
                "flex flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors",
                active
                  ? "border-primary bg-primary/6"
                  : "border-border bg-paper hover:border-primary/40"
              )}
            >
              <TemplateThumb template={template} src={thumbs[template.id]} />
              <span
                className={cn(
                  "truncate text-[10.5px]",
                  active
                    ? "font-semibold text-primary-strong"
                    : "font-medium text-muted-foreground"
                )}
              >
                {template.name}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function nextStep(zoom: number): number {
  return ZOOM_STEPS.find((step) => step > zoom) ?? zoom
}

function previousStep(zoom: number): number {
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom) ?? zoom
}
