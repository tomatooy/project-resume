import {
  CaretDownIcon,
  CaretUpIcon,
  MinusIcon,
  PlusIcon,
} from "@phosphor-icons/react"
import {
  templateList,
  type FontScale,
  type PageSize,
  type TemplateId,
} from "@workspace/resume-render"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { lazy, Suspense, useCallback, useState } from "react"

import { ClientOnly } from "@/lib/client-only"
import { useResumeState, useSession } from "../session-context"
import { usePreview, usePreviewStore } from "./preview-context"
import { ZOOM_STEPS } from "./preview-store"
import { TemplateThumb } from "./TemplateThumb"

const PdfViewer = lazy(() =>
  import("./PdfViewer").then((m) => ({ default: m.PdfViewer }))
)

const PAGE_LABEL: Record<PageSize, string> = {
  LETTER: "Letter · 8.5 × 11 in",
  A4: "A4 · 210 × 297 mm",
}

/** The three scales every template is laid out to survive. */
const FONT_SCALES: { value: FontScale; label: string }[] = [
  { value: 0.9, label: "Compact" },
  { value: 1, label: "Normal" },
  { value: 1.1, label: "Large" },
]

export function PreviewPane({ compact = false }: { compact?: boolean }) {
  const session = useSession()
  const templateId = useResumeState((s) => s.templateId)
  const options = useResumeState((s) => s.templateOptions)
  const store = usePreviewStore()
  const blob = usePreview((s) => s.blob)
  const loading = usePreview((s) => s.loading)
  const zoom = usePreview((s) => s.zoom)
  const pageCount = usePreview((s) => s.pageCount)
  const [menuOpen, setMenuOpen] = useState(false)

  const picked =
    templateList.find((t) => t.id === templateId) ?? templateList[0]

  const setZoom = (next: number) =>
    store.setState((s) => ({ ...s, zoom: Math.min(150, Math.max(50, next)) }))

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
      <div className="relative flex-none border-b border-border bg-paper">
        {loading ? (
          <span className="absolute inset-x-0 top-0 h-[2px] overflow-hidden">
            <span className="block h-full w-1/3 animate-[preview-scan_1.1s_ease-in-out_infinite] bg-primary/70" />
          </span>
        ) : null}

        <div className="flex h-11 items-center gap-2 px-3.5">
          <span className="text-[11.5px] font-semibold">Live preview</span>
          <button
            type="button"
            onClick={togglePageSize}
            className="rounded-md px-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Switch page size"
          >
            {PAGE_LABEL[options.pageSize]}
          </button>

          {pageCount ? (
            <span className="rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {pageCount} {pageCount === 1 ? "page" : "pages"}
            </span>
          ) : null}

          <div className="flex-1" />

          <div className="flex items-center gap-0.5 text-muted-foreground">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Zoom out"
              disabled={zoom <= ZOOM_STEPS[0]}
              onClick={() => setZoom(previousStep(zoom))}
            >
              <MinusIcon />
            </Button>
            <span className="w-9 text-center text-[11px] tabular-nums">
              {zoom}%
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Zoom in"
              disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
              onClick={() => setZoom(nextStep(zoom))}
            >
              <PlusIcon />
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[7px] border px-2.5 text-[11.5px] font-semibold transition-colors",
              menuOpen
                ? "border-primary bg-primary/8 text-primary-strong"
                : "border-border bg-paper text-foreground hover:bg-muted"
            )}
          >
            {picked.name}
            {menuOpen ? (
              <CaretUpIcon className="size-2.5 opacity-60" />
            ) : (
              <CaretDownIcon className="size-2.5 opacity-60" />
            )}
          </button>
        </div>

        {menuOpen ? (
          <TemplateMenu
            selected={templateId}
            fontScale={options.fontScale}
            onSelect={(id) => {
              void session.setTemplate(id)
              setMenuOpen(false)
            }}
            onFontScale={setFontScale}
          />
        ) : null}
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 justify-center overflow-auto",
          compact ? "px-5 pt-5 pb-[22px]" : "px-5 pt-[22px] pb-[76px]"
        )}
      >
        <ClientOnly>
          <Suspense fallback={null}>
            <PdfViewer
              blob={blob}
              baseWidth={420}
              zoom={zoom}
              onPageCount={onPageCount}
            />
          </Suspense>
        </ClientOnly>
      </div>
    </div>
  )
}

function TemplateMenu({
  selected,
  fontScale,
  onSelect,
  onFontScale,
}: {
  selected: TemplateId
  fontScale: FontScale
  onSelect: (id: TemplateId) => void
  onFontScale: (scale: FontScale) => void
}) {
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
              <TemplateThumb template={template} />
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

      <span className="mt-3.5 block text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        Text size
      </span>
      <div className="mt-2 flex gap-[7px]">
        {FONT_SCALES.map((scale) => {
          const active = scale.value === fontScale
          return (
            <button
              key={scale.value}
              type="button"
              onClick={() => onFontScale(scale.value)}
              title={`Scale every size in the document to ${Math.round(scale.value * 100)} percent`}
              className={cn(
                "h-[26px] rounded-full border px-2.5 text-[11.5px] transition-colors",
                active
                  ? "border-transparent bg-ink font-medium text-background"
                  : "border-border bg-paper text-foreground hover:bg-muted"
              )}
            >
              {scale.label}
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
