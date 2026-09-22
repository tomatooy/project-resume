import { UploadSimpleIcon, WarningIcon } from "@phosphor-icons/react"
import type { SkillDraft } from "@workspace/resume-core"
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
import { useEffect, useRef, useState } from "react"

import { useImportSkillMarkdown } from "@/lib/queries"

/**
 * Reads a `SKILL.md` into the editor.
 *
 * The file names itself and says when it applies in a `---` block; its
 * `description:` fills the description. Parsing happens on the server, and
 * what comes back prefills the editor rather than saving: the user sees what
 * the file was read as before it joins their library.
 */
export function ImportSkillDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (input: SkillDraft) => void
}) {
  const [text, setText] = useState("")
  const [fileName, setFileName] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const parse = useImportSkillMarkdown()
  const reset = parse.reset

  // A second import starts from nothing, not from the last file's text.
  // `reset` is a method on the observer's stable instance, so this runs when
  // the dialog opens rather than on every render.
  useEffect(() => {
    if (open) {
      setText("")
      setFileName(null)
      reset()
    }
  }, [open, reset])

  async function take(file: File | undefined) {
    if (!file) return
    setFileName(file.name)
    setText(await file.text())
  }

  function read() {
    parse.mutate(
      { text },
      {
        onSuccess: (input) => onImported(input),
        onError: () => {
          if (fileInput.current) fileInput.current.value = ""
        },
      }
    )
  }

  const error = parse.error?.message

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Import a SKILL.md</DialogTitle>
          <DialogDescription>
            Import the name, description and body into a new skill. Review and
            edit the fields before adding it to your library.
          </DialogDescription>
        </DialogHeader>

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
              void take(event.dataTransfer.files[0])
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed px-4 py-7 transition-colors",
              dragging
                ? "border-primary bg-primary/6 text-primary"
                : "border-border text-muted-foreground hover:border-primary hover:bg-card hover:text-primary"
            )}
          >
            <UploadSimpleIcon className="size-5" />
            <span className="max-w-full text-[12.5px] font-medium wrap-anywhere">
              {fileName ?? "Drop a SKILL.md here, or click to choose one"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              It stays in your browser until you press Read.
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="text/markdown,text/plain,.md,.markdown,.txt"
            className="hidden"
            onChange={(event) => void take(event.target.files?.[0])}
          />

          {error ? (
            <div className="flex items-start gap-2.5 rounded-[9px] border border-destructive/40 bg-destructive/6 p-3">
              <WarningIcon className="mt-px size-4 flex-none text-destructive" />
              <p className="min-w-0 text-[12px] leading-[1.5] text-muted-foreground wrap-anywhere">
                {error}
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="skill-markdown"
              className="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase"
            >
              Or paste the file
            </label>
            <Textarea
              id="skill-markdown"
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                setFileName(null)
              }}
              rows={7}
              placeholder={
                "---\nname: …\ndescription: …\n---\n\nThe guidance itself."
              }
              className="field-sizing-fixed max-h-48 min-w-0 max-w-full resize-y font-mono text-[11.5px]"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button size="sm" disabled={parse.isPending} onClick={read}>
              Read this file
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
