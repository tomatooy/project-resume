import { templates } from "@workspace/resume-render"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { toast } from "sonner"

import { slug } from "@/lib/format"
import { usePreview } from "../resume/preview/preview-context"
import { useResumeState } from "../resume/session-context"
import { Preflight } from "./Preflight"

type Format = {
  ext: string
  name: string
  note: string
  action: string
  available: boolean
}

const FORMATS: Format[] = [
  {
    ext: "PDF",
    name: "PDF, ATS safe",
    note: "Selectable text with embedded fonts. What recruiters and parsers both read.",
    action: "Download",
    available: true,
  },
  {
    ext: "DOCX",
    name: "Word document",
    note: "An editable .docx keeping the current template's styles. Some agencies require it.",
    action: "Download",
    available: false,
  },
  {
    ext: "TXT",
    name: "Plain text",
    note: "Stripped copy for portals that only accept pasted text.",
    action: "Copy text",
    available: false,
  },
  {
    ext: "JSON",
    name: "JSON Resume",
    note: "Structured export for your own tooling or portfolio site.",
    action: "Download",
    available: false,
  },
]

export function ExportScreen() {
  const doc = useResumeState((s) => s.doc)
  const templateId = useResumeState((s) => s.templateId)
  const options = useResumeState((s) => s.templateOptions)
  const blob = usePreview((s) => s.blob)
  const loading = usePreview((s) => s.loading)
  const pageCount = usePreview((s) => s.pageCount)

  const template = templates[templateId]
  const filename = `${slug(doc.basics.name)}-resume.pdf`

  const download = () => {
    if (!blob) return
    // The blob is already rendered for the preview, so exporting is free.
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
    toast.success(`Downloaded ${filename}`)
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-[880px] px-[26px] pt-[26px] pb-[110px]">
        <h2 className="font-heading text-[19px] font-semibold tracking-[-0.015em]">
          Export
        </h2>
        <p className="mt-1.5 mb-5 text-[12.5px] text-muted-foreground">
          {template.name} · {options.pageSize === "LETTER" ? "Letter" : "A4"} ·{" "}
          {pageCount
            ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}`
            : "measuring"}
        </p>

        <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
          {FORMATS.map((format) => (
            <div
              key={format.ext}
              className={cn(
                "flex flex-col rounded-[10px] border bg-paper p-4",
                format.available
                  ? "border-primary/40 shadow-[0_0_0_3px_oklch(0.5_0.134_242.749/10%)]"
                  : "border-border"
              )}
            >
              <div className="flex items-center gap-[9px]">
                <span
                  className={cn(
                    "rounded-[5px] px-[7px] py-[3px] text-[10px] font-bold tracking-[0.05em]",
                    format.available
                      ? "bg-muted text-primary-strong"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {format.ext}
                </span>
                <span className="font-heading text-[13.5px] font-semibold tracking-[-0.01em]">
                  {format.name}
                </span>
              </div>

              <p className="mt-2 text-[12px] leading-[1.5] text-pretty text-muted-foreground">
                {format.note}
              </p>

              <div className="flex-1" />

              {format.available ? (
                <Button
                  className="mt-3.5 w-full"
                  disabled={!blob || loading}
                  onClick={download}
                >
                  {loading && !blob ? "Rendering…" : format.action}
                </Button>
              ) : (
                <Button className="mt-3.5 w-full" variant="outline" disabled>
                  Not in this release
                </Button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6">
          <Preflight />
        </div>
      </div>
    </div>
  )
}
