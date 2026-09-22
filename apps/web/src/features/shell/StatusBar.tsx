import {
  ClockCounterClockwiseIcon,
  EyeIcon,
  SidebarSimpleIcon,
  SparkleIcon,
} from "@phosphor-icons/react"
import { useNavigate, useParams } from "@tanstack/react-router"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { useShellLayout } from "./shell-layout"
import { useResumeTab } from "./resume-tabs"

/**
 * Where a screen puts a control of its own in the bar, next to the rail
 * switch. The bar is rendered by the app shell, above the route that owns the
 * document, so a screen cannot reach it by rendering one: the shell leaves
 * this host in the bar and the screen portals into it. Portal children keep
 * their React context, so a control mounted this way still reads the session
 * it was mounted under.
 */
const STATUS_BAR_EXTRA_ID = "status-bar-extra"

export function StatusBarExtra({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null)

  // The host is committed by the bar, a sibling in the shell's tree, before
  // any effect in a route runs.
  useEffect(() => {
    setHost(document.getElementById(STATUS_BAR_EXTRA_ID))
  }, [])

  return host ? createPortal(children, host) : null
}

/**
 * The bar across the bottom of the shell. It holds what is true of every
 * screen below it: the resume rail's switch on the left, the side panels'
 * switches on the right, all as icons in a 28px strip. The screens themselves
 * switch with the tab strip at the top of the middle column.
 */
export function StatusBar() {
  const { panels, togglePanel, railCollapsed, toggleRail } = useShellLayout()
  const { resumeId } = useParams({ strict: false })
  const navigate = useNavigate()

  // The tab strip and this shortcut highlight Versions from one value, so the
  // two cannot drift apart.
  const tab = useResumeTab(resumeId)

  return (
    <footer className="surface-metal grid h-7 flex-none grid-cols-[1fr_auto_1fr] items-center border-t bg-card px-3">
      <div className="flex items-center gap-0.5">
        <BarButton
          icon={<SidebarSimpleIcon />}
          label={railCollapsed ? "Show resumes" : "Hide resumes"}
          pressed={!railCollapsed}
          onClick={toggleRail}
        />
        <div id={STATUS_BAR_EXTRA_ID} className="flex items-center gap-0.5" />
      </div>

      {/* The middle cell is empty until the save status moves here from the
          form's own header. It stays a cell so the right-hand run keeps its
          place in the grid. */}
      <div />

      <div className="flex items-center justify-end gap-0.5">
        {resumeId ? (
          <>
            <BarButton
              icon={<ClockCounterClockwiseIcon />}
              label="Versions"
              pressed={tab.id === "versions"}
              onClick={() =>
                navigate({
                  to: "/r/$resumeId/versions",
                  params: { resumeId },
                })
              }
            />
            <BarButton
              icon={<EyeIcon />}
              label="Preview"
              pressed={panels.preview}
              onClick={() => togglePanel("preview")}
            />
            <BarButton
              icon={<SparkleIcon />}
              label="Assistant"
              pressed={panels.assistant}
              onClick={() => togglePanel("assistant")}
            />
          </>
        ) : null}
      </div>
    </footer>
  )
}

function BarButton({
  icon,
  label,
  pressed,
  onClick,
}: {
  icon: ReactNode
  label: string
  pressed: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
            className={cn(
              "flex size-6 items-center justify-center rounded-[5px] transition-colors [&_svg]:size-3.5",
              pressed
                ? "bg-accent text-primary-text"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {icon}
          </button>
        }
      />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}
