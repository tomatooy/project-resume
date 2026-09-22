import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  BookmarkSimpleIcon,
  CheckIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { toast } from "sonner"

import { useCreateSnapshot } from "@/lib/queries"
import { useResumeState, useSession } from "../session-context"
import type { SaveStatus } from "../store"

const LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving",
  error: "Retrying",
  conflict: "Conflict",
}

export function SaveBar() {
  const session = useSession()
  const status = useResumeState((s) => s.saveStatus)
  const savable = useResumeState((s) => s.validity.savable)
  const resumeId = useResumeState((s) => s.resumeId)
  const snapshot = useCreateSnapshot(resumeId)

  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {status === "saving" ? <Spinner className="size-3" /> : null}
        {status === "saved" ? (
          <CheckIcon className="size-3 text-success" />
        ) : null}
        {status === "error" || status === "conflict" ? (
          <WarningIcon className="size-3 text-warning" />
        ) : null}
        {savable ? LABEL[status] : "Fix errors to save"}
      </span>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Undo"
              disabled={!session.canUndo}
              onClick={() => session.undo()}
            >
              <ArrowCounterClockwiseIcon />
            </Button>
          }
        />
        <TooltipContent>Undo</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Redo"
              disabled={!session.canRedo}
              onClick={() => session.redo()}
            >
              <ArrowClockwiseIcon />
            </Button>
          }
        />
        <TooltipContent>Redo</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="icon-xs"
              className="border-none"
              aria-label="Save version"
              onClick={() =>
                snapshot.mutate(undefined, {
                  onSuccess: (version) =>
                    toast.success(`Saved version ${version.versionNo}`),
                })
              }
              disabled={snapshot.isPending}
            >
              {snapshot.isPending ? <Spinner /> : <BookmarkSimpleIcon />}
            </Button>
          }
        />
        <TooltipContent>Save version</TooltipContent>
      </Tooltip>
    </div>
  )
}
