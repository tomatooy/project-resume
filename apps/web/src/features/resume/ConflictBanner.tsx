import { WarningIcon } from "@phosphor-icons/react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"

import { resumeQuery } from "@/lib/queries"
import { useResumeState, useSession } from "./session-context"

/**
 * Shown when the server copy moved on under us, which in practice means the
 * same resume is open in another tab. Both ways out are explicit: neither
 * silently loses work.
 */
export function ConflictBanner() {
  const session = useSession()
  const status = useResumeState((s) => s.saveStatus)
  const resumeId = useResumeState((s) => s.resumeId)
  const queryClient = useQueryClient()

  if (status !== "conflict") return null

  return (
    <div className="mb-4 flex items-start gap-3 rounded-[9px] border border-warning/45 bg-warning/8 p-3.5">
      <WarningIcon className="mt-0.5 size-4 flex-none text-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold text-foreground">
          This resume changed somewhere else
        </p>
        <p className="mt-1 text-[12px] leading-[1.5] text-muted-foreground">
          Your edits are still here and have not been saved. Reload to take the
          other version, or overwrite it with what is on screen.
        </p>
        <div className="mt-2.5 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              // Always the server's copy, never the one the loader cached.
              const fresh = await queryClient.fetchQuery({
                ...resumeQuery(resumeId),
                staleTime: 0,
              })
              session.discardLocal(fresh)
            }}
          >
            Reload theirs
          </Button>
          <Button size="sm" onClick={() => void session.overwrite()}>
            Keep mine
          </Button>
        </div>
      </div>
    </div>
  )
}
