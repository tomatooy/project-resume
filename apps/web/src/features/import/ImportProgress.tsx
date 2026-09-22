import { CheckCircleIcon, CircleIcon } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { Progress } from "@workspace/ui/components/progress"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import type { ImportProgress, ImportStage } from "./use-import"

const STAGES: { id: ImportStage; label: string }[] = [
  { id: "reading", label: "Reading the file" },
  { id: "extracting", label: "Pulling out the text" },
  { id: "parsing", label: "Reading your resume" },
]

/**
 * Two of the three stages know exactly where they are, so they say so; the
 * model call does not, so it gets the same indeterminate bar the PDF preview
 * uses rather than a percentage nobody could compute.
 */
export function ImportProgressPanel({
  progress,
  onCancel,
}: {
  progress: ImportProgress
  onCancel: () => void
}) {
  const current = STAGES.findIndex((stage) => stage.id === progress.stage)
  const pages = progress.pageCount

  return (
    <div className="flex flex-col gap-4 py-1">
      <ol className="flex flex-col gap-2.5">
        {STAGES.map((stage, index) => {
          const state =
            index < current ? "done" : index === current ? "active" : "waiting"
          return (
            <li
              key={stage.id}
              className={cn(
                "flex items-center gap-2.5 text-[12.5px]",
                state === "waiting" && "text-muted-foreground/60",
                state === "done" && "text-muted-foreground",
                state === "active" && "font-medium text-foreground"
              )}
            >
              {state === "done" ? (
                <CheckCircleIcon
                  weight="fill"
                  className="size-4 flex-none text-success"
                />
              ) : state === "active" ? (
                <Spinner className="size-4 flex-none text-primary" />
              ) : (
                <CircleIcon className="size-4 flex-none" />
              )}
              <span>{stage.label}</span>
              {state === "active" && stage.id === "extracting" && pages > 0 ? (
                <span className="ms-auto text-[11.5px] text-muted-foreground tabular-nums">
                  page {progress.page} of {pages}
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>

      {progress.stage === "extracting" && pages > 0 ? (
        <Progress value={(progress.page / pages) * 100} />
      ) : (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <span className="block h-full w-1/3 animate-[preview-scan_1.1s_ease-in-out_infinite] rounded-full bg-primary/70" />
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11.5px] text-muted-foreground">
          Keep this open. Closing it stops the import.
        </p>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
