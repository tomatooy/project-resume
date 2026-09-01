import { Link, useMatchRoute } from "@tanstack/react-router"
import { cn } from "@workspace/ui/lib/utils"

const MODES = [
  { to: "/r/$resumeId/edit", label: "Editor" },
  { to: "/r/$resumeId/export", label: "Export" },
  { to: "/r/$resumeId/interview", label: "Interview" },
  { to: "/r/$resumeId/history", label: "History" },
] as const

/**
 * The floating mode switcher, centred over the content area. It clears the
 * 252px rail so it never sits over the resume list.
 */
export function ModePill({ resumeId }: { resumeId: string }) {
  const matchRoute = useMatchRoute()

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[22px] z-40 flex justify-center pl-[252px]">
      <div className="pointer-events-auto flex gap-[3px] rounded-full border border-border bg-paper p-1 shadow-[0_12px_30px_-10px_oklch(0.145_0_0/26%)]">
        {MODES.map((mode) => {
          const active = Boolean(
            matchRoute({ to: mode.to, params: { resumeId } })
          )
          return (
            <Link
              key={mode.to}
              to={mode.to}
              params={{ resumeId }}
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
      </div>
    </div>
  )
}
