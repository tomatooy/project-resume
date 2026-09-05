import {
  FilePdfIcon,
  UploadSimpleIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import { useCallback, useRef, useState } from "react"

import type { ResumeSummary } from "@/lib/types"
import { resumesQuery, useCreateResume } from "@/lib/queries"
import { ImportProgressPanel } from "./ImportProgress"
import { useImport } from "./use-import"

/**
 * One dialog for every way of starting a resume: a file, pasted text, or
 * nothing at all.
 *
 * Upload and paste share a view rather than sitting behind a switch, because
 * paste is where an unreadable file sends you and it should already be on
 * screen when that happens.
 */
export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [pasted, setPasted] = useState("")
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const pasteBox = useRef<HTMLTextAreaElement | null>(null)

  const finish = useCallback(
    async (resume: ResumeSummary) => {
      await queryClient.invalidateQueries({
        queryKey: resumesQuery().queryKey,
      })
      onOpenChange(false)
      setPasted("")
      void navigate({
        to: "/r/$resumeId/edit",
        params: { resumeId: resume.id },
      })
    },
    [navigate, onOpenChange, queryClient]
  )

  const done = useCallback(
    (resume: ResumeSummary) => {
      void finish(resume)
    },
    [finish]
  )

  const { progress, failure, warning, busy, run, cancel, reset } =
    useImport(done)

  const blank = useCreateResume()

  const take = (file: File | undefined) => {
    if (!file) return
    void run({ kind: "file", file }).then(() => {
      // Focusing the paste box is the whole point of the fallback: the way out
      // of an unreadable file is already on screen.
      if (fileInput.current) fileInput.current.value = ""
      pasteBox.current?.focus()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // The work lives inside this request. Closing would abandon it, so the
        // only way out while it runs is the Cancel button, which says so.
        if (!next && busy) return
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-[520px]" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>New resume</DialogTitle>
          <DialogDescription>
            Start from a resume you already have, or from a blank page.
          </DialogDescription>
        </DialogHeader>

        {progress ? (
          <ImportProgressPanel progress={progress} onCancel={cancel} />
        ) : (
          <div className="flex flex-col gap-3.5">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                take(event.dataTransfer.files[0])
              }}
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed px-4 py-7 transition-colors",
                dragging
                  ? "border-primary bg-primary/6 text-primary"
                  : "border-border text-muted-foreground hover:border-primary hover:bg-paper hover:text-primary"
              )}
            >
              <UploadSimpleIcon className="size-5" />
              <span className="text-[12.5px] font-medium">
                Drop a PDF here, or click to choose one
              </span>
              <span className="text-[11px] text-muted-foreground">
                Up to 10 pages. The file stays in your browser.
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => take(event.target.files?.[0])}
            />

            {failure ? (
              <Notice tone="error" text={failure.message} />
            ) : warning ? (
              <Notice tone="warn" text={warning} />
            ) : null}

            <div>
              <label
                htmlFor="import-paste"
                className="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase"
              >
                Or paste your resume text
              </label>
              <Textarea
                id="import-paste"
                ref={pasteBox}
                rows={5}
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                placeholder="Paste the whole resume, headings and all."
                className="mt-1.5 max-h-40 text-[12.5px]"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={blank.isPending}
                onClick={() => blank.mutate({}, { onSuccess: finish })}
              >
                Start with a blank resume
              </Button>
              <Button
                size="sm"
                disabled={pasted.trim().length < 40}
                onClick={() => void run({ kind: "text", text: pasted })}
              >
                <FilePdfIcon />
                Read this text
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Notice({ tone, text }: { tone: "error" | "warn"; text: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[9px] border p-3",
        tone === "error"
          ? "border-destructive/40 bg-destructive/6"
          : "border-flag/45 bg-flag/8"
      )}
    >
      <WarningIcon
        className={cn(
          "mt-px size-4 flex-none",
          tone === "error" ? "text-destructive" : "text-flag-foreground"
        )}
      />
      <p className="text-[12px] leading-[1.5] text-muted-foreground">{text}</p>
    </div>
  )
}
