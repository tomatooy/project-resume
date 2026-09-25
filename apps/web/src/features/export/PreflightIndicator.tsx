import { WarningIcon } from "@phosphor-icons/react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { usePreview } from "../resume/preview/preview-context"
import { pluralize } from "@/lib/format"
import { PreflightList, usePreflightChecks } from "./Preflight"
import { preflightWarnCount } from "./preflight-checks"

/**
 * The Export screen's preflight, as a status bar control: the triangle and the
 * count are always there, and the popover is where the reasons are. The checks
 * are the ones `Preflight` renders, read through the same hook.
 */
export function PreflightIndicator() {
  const stale = usePreview((s) => s.stale)
  const loading = usePreview((s) => s.loading)
  const checks = usePreflightChecks()
  const warns = preflightWarnCount(checks)
  const label =
    warns === 0
      ? "Preflight: nothing to fix"
      : `Preflight: ${pluralize(warns, "warning")}`

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              type="button"
              aria-label={label}
              className={cn(
                "flex h-6 items-center gap-1 rounded-[5px] px-1.5 transition-colors",
                "hover:bg-muted data-popup-open:bg-primary/9 data-popup-open:text-primary-text",
                warns > 0
                  ? "text-warning"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <WarningIcon className="size-3.5" />
              <span className="text-[11px] font-semibold tabular-nums">
                {warns}
              </span>
              {stale ? (
                <span className="text-[11px] text-muted-foreground">
                  {loading ? "Measuring pages" : "Pages not measured"}
                </span>
              ) : null}
            </PopoverTrigger>
          }
        />
        <TooltipContent side="top">Preflight</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-[21rem] gap-0 p-0"
      >
        <div className="flex items-baseline justify-between gap-3 border-b border-border px-3 py-2">
          <span className="text-[10.5px] font-bold tracking-[0.05em] text-muted-foreground uppercase">
            Preflight
          </span>
          <span className="text-[11px] text-muted-foreground">
            {warns === 0 ? "Nothing to fix" : pluralize(warns, "warning")}
          </span>
        </div>
        <div className="max-h-[min(60vh,26rem)] overflow-y-auto p-3">
          <PreflightList checks={checks} />
        </div>
      </PopoverContent>
    </Popover>
  )
}
