import { ArrowsInSimpleIcon, ArrowsOutSimpleIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import { cn } from "@workspace/ui/lib/utils"

import { IconButton } from "./IconButton"
import { RESUME_TABS, useResumeTab } from "./resume-tabs"

/**
 * The four ways to look at the open resume, across the top of the middle
 * column. The strip lives above the route, so switching a tab swaps only the
 * middle column: the rail and the side panes do not move with it. The active
 * tab is white and hangs one pixel over the strip's border, joining the paper
 * column below it. At the far end, where the last tab leaves off, sits the
 * middle column's own switch: it takes the whole row and stands the side panes
 * down, or brings them back.
 */
export function ResumeTabs({
  resumeId,
  fullWidth,
  onToggleFullWidth,
}: {
  resumeId: string
  fullWidth: boolean
  onToggleFullWidth: () => void
}) {
  const active = useResumeTab(resumeId)

  return (
    <nav
      aria-label="Resume views"
      className="flex h-11 flex-none items-stretch gap-0.5 border-b border-border bg-background pr-1"
    >
      {RESUME_TABS.map((tab) => {
        const current = tab.id === active.id
        return (
          <Link
            key={tab.id}
            to={tab.to}
            params={{ resumeId }}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex items-center px-3 font-heading text-[12px] font-semibold transition-colors",
              current
                ? "-mb-px bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        )
      })}

      <div className="flex-1" />

      <IconButton
        label={fullWidth ? "Restore the side panels" : "Full width"}
        aria-pressed={fullWidth}
        className="self-center"
        onClick={onToggleFullWidth}
      >
        {fullWidth ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}
      </IconButton>
    </nav>
  )
}
