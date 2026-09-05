import { Link, useMatchRoute } from "@tanstack/react-router"
import { cn } from "@workspace/ui/lib/utils"

const MODES = [
  { to: "/r/$resumeId/edit", label: "Editor" },
  { to: "/r/$resumeId/export", label: "Export" },
  { to: "/r/$resumeId/interview", label: "Interview" },
] as const

/**
 * The three screens of an open resume as inline tabs. The index route
 * redirects into /edit, so a mode is always active.
 */
export function ModeSwitcher({ resumeId }: { resumeId: string }) {
  const matchRoute = useMatchRoute()

  return (
    <nav
      aria-label="Resume views"
      className="flex gap-[3px] rounded-full bg-paper p-1"
    >
      {MODES.map((mode) => {
        const active = Boolean(
          matchRoute({ to: mode.to, params: { resumeId } })
        )
        return (
          <Link
            key={mode.to}
            to={mode.to}
            params={{ resumeId }}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-[30px] items-center rounded-full px-4 font-heading text-[12.5px] font-semibold transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {mode.label}
          </Link>
        )
      })}
    </nav>
  )
}
