import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"

import { AppHeader } from "@/features/shell/AppHeader"
import { RailSlotProvider } from "@/features/shell/rail-slot"
import { ResumeRail } from "@/features/shell/ResumeRail"
import {
  RAIL_MAX_WIDTH,
  RAIL_MIN_WIDTH,
  RAIL_WIDTH,
  ShellLayoutProvider,
  useShellLayoutState,
} from "@/features/shell/shell-layout"
import { StatusBar } from "@/features/shell/StatusBar"
import { getSession } from "@/server/fns/session"

export const Route = createFileRoute("/_app")({
  // Every screen below here is private. The guard runs before the loaders of
  // the child routes, so a signed-out visitor never triggers a data fetch that
  // would only come back empty.
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    if (!session) {
      throw redirect({ to: "/login", search: { next: location.href } })
    }
    return { session }
  },
  loader: ({ context }) => context.session,
  component: AppLayout,
})

function AppLayout() {
  const session = Route.useLoaderData()
  const shell = useShellLayoutState()

  return (
    <ShellLayoutProvider layout={shell.layout}>
      {/* The rail and the route below it are siblings, so the slot that lets a
          screen render into the open resume's row lives above both. */}
      <RailSlotProvider>
        <div className="flex h-svh flex-col overflow-hidden bg-background">
          <AppHeader email={session.email} />
          <div className="relative flex min-h-0 flex-1">
            <ResizablePanelGroup orientation="horizontal" {...shell.group}>
              <ResizablePanel
                id="rail"
                defaultSize={RAIL_WIDTH}
                minSize={RAIL_MIN_WIDTH}
                maxSize={RAIL_MAX_WIDTH}
                collapsible
                panelRef={shell.railRef}
                onResize={shell.onRailResize}
                className="overflow-hidden"
              >
                <ResumeRail />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel
                id="content"
                minSize={320}
                className="overflow-hidden"
              >
                <Outlet />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
          <StatusBar />
        </div>
      </RailSlotProvider>
    </ShellLayoutProvider>
  )
}
