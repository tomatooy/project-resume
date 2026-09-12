import { CaretUpIcon, CheckIcon } from "@phosphor-icons/react"
import { useMatchRoute, useNavigate } from "@tanstack/react-router"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"

const MODES = [
  { to: "/r/$resumeId/edit", label: "Editor" },
  { to: "/r/$resumeId/export", label: "Export" },
  { to: "/r/$resumeId/interview", label: "Interview" },
] as const

/**
 * The three screens of an open resume behind one button in the status bar: the
 * current one beside an up caret, the list rising over the bar. The index route
 * redirects into /edit, so a mode is always active.
 */
export function ModeSwitcher({ resumeId }: { resumeId: string }) {
  const matchRoute = useMatchRoute()
  const navigate = useNavigate()

  const current =
    MODES.find((mode) => matchRoute({ to: mode.to, params: { resumeId } })) ??
    MODES[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Screen: ${current.label}`}
            title="Switch screen"
            className={cn(
              "flex h-6 items-center gap-1 rounded-[6px] px-2 font-heading text-[12px] font-semibold transition-colors",
              "text-muted-foreground hover:bg-muted hover:text-foreground",
              "data-popup-open:bg-primary/9 data-popup-open:text-primary-deep"
            )}
          >
            {current.label}
            <CaretUpIcon className="size-3 opacity-60" />
          </button>
        }
      />
      <DropdownMenuContent
        side="top"
        align="center"
        sideOffset={6}
        className="w-40"
      >
        {MODES.map((mode) => {
          const active = mode.to === current.to
          return (
            <DropdownMenuItem
              key={mode.to}
              className="text-[12.5px]"
              onClick={() => navigate({ to: mode.to, params: { resumeId } })}
            >
              {mode.label}
              {active ? (
                <CheckIcon className="ms-auto size-3 text-primary-deep" />
              ) : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
