import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  BookmarkSimpleIcon,
  CheckIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { toast } from "sonner"

import { createSnapshot } from "@/lib/api"
import { qk } from "@/lib/query-keys"
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
  const hasErrors = useResumeState((s) => s.hasFieldErrors)
  const resumeId = useResumeState((s) => s.resumeId)
  const queryClient = useQueryClient()

  const snapshot = useMutation({
    mutationFn: () => createSnapshot({ resumeId }),
    onSuccess: async (version) => {
      await queryClient.invalidateQueries({ queryKey: qk.versions(resumeId) })
      toast.success(`Saved version ${version.versionNo}`)
    },
  })

  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {status === "saving" ? <Spinner className="size-3" /> : null}
        {status === "saved" ? <CheckIcon className="size-3 text-ok" /> : null}
        {status === "error" || status === "conflict" ? (
          <WarningIcon className="size-3 text-flag" />
        ) : null}
        {hasErrors ? "Fix errors to save" : LABEL[status]}
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

      <Button
        variant="outline"
        size="xs"
        onClick={() => snapshot.mutate()}
        disabled={snapshot.isPending}
      >
        <BookmarkSimpleIcon />
        Save version
      </Button>
    </div>
  )
}
