import type { ErrorComponentProps } from "@tanstack/react-router"
import { useRouter } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { useWorkspace } from "./context"
import { routeTarget, tabKey } from "./targets"

export function ResourceFailure({
  error,
  reset,
}: Pick<ErrorComponentProps, "error" | "reset">) {
  const router = useRouter()
  const workspace = useWorkspace()
  return (
    <div
      role="alert"
      className="flex min-h-0 flex-1 flex-col items-start gap-3 bg-card p-6 text-sm"
    >
      <h2 className="font-heading font-semibold">Could not open this page</h2>
      <p className="text-muted-foreground">{error.message}</p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => {
            reset()
            void router.invalidate()
          }}
        >
          Try again
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            const target = routeTarget(router.state.location.pathname)
            if (target) void workspace.requestCloseTabs([tabKey(target)])
          }}
        >
          Close tab
        </Button>
      </div>
    </div>
  )
}
