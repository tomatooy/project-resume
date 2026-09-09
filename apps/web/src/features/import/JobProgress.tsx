import { CheckCircleIcon, CircleIcon } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import type { TailorStage } from "./use-tailor"

const STAGES: { id: TailorStage; label: string }[] = [
  { id: "reading", label: "Reading the job posting" },
  { id: "writing", label: "Writing your resume" },
]

/** Neither stage can be measured, so both get the indeterminate bar rather
 *  than a percentage nobody could compute. */
export function JobProgressPanel({
  stage,
  onCancel,
}: {
  stage: TailorStage
  onCancel: () => void
}) {
  const current = STAGES.findIndex((entry) => entry.id === stage)

  return (
    <div className="flex flex-col gap-4 py-1">
      <ol className="flex flex-col gap-2.5">
        {STAGES.map((entry, index) => {
          const state =
            index < current ? "done" : index === current ? "active" : "waiting"
          return (
            <li
              key={entry.id}
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
                  className="size-4 flex-none text-ok"
                />
              ) : state === "active" ? (
                <Spinner className="size-4 flex-none text-primary" />
              ) : (
                <CircleIcon className="size-4 flex-none" />
              )}
              <span>{entry.label}</span>
            </li>
          )
        })}
      </ol>

      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <span className="block h-full w-1/3 animate-[preview-scan_1.1s_ease-in-out_infinite] rounded-full bg-primary/70" />
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11.5px] text-muted-foreground">
          Keep this open. Closing it stops the work.
        </p>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
