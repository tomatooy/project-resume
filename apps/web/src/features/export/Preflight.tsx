import { cn } from "@workspace/ui/lib/utils"

import { usePreview } from "../resume/preview/preview-context"
import { useResumeState } from "../resume/session-context"
import { preflightChecks, type PreflightCheck } from "./preflight-checks"

/**
 * The four facts every preflight answer is made of. Both surfaces read the
 * checks through this, so neither can be reading a different document.
 */
export function usePreflightChecks(): PreflightCheck[] {
  const doc = useResumeState((s) => s.doc)
  const templateId = useResumeState((s) => s.templateId)
  const pageCount = usePreview((s) => s.pageCount)
  const error = usePreview((s) => s.error)

  return preflightChecks({ doc, templateId, pageCount, error })
}

/** The Export screen's panel: the checks as a card, between the formats. */
export function Preflight() {
  const checks = usePreflightChecks()

  return (
    <div className="rounded-[10px] border border-border bg-paper p-4">
      <div className="mb-3 text-[10.5px] font-bold tracking-[0.05em] text-muted-foreground uppercase">
        Preflight
      </div>
      <PreflightList checks={checks} />
    </div>
  )
}

/**
 * One row per check, shared by the Export panel and the status bar popover, so
 * the two cannot render the same check two ways.
 */
export function PreflightList({
  checks,
  className,
}: {
  checks: PreflightCheck[]
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {checks.map((check) => (
        <div key={check.title} className="flex items-start gap-2.5">
          <span
            className={cn(
              "mt-[5px] size-2 flex-none rounded-full",
              check.level === "warn" ? "bg-flag" : "bg-ok"
            )}
          />
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold">{check.title}</div>
            <div className="mt-0.5 text-[11.5px] leading-[1.45] text-pretty text-muted-foreground">
              {check.detail}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
