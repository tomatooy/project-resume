import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { AppHeader } from "@/features/shell/AppHeader"
import { ResumeRail } from "@/features/shell/ResumeRail"
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

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-canvas">
      <AppHeader email={session.email} />
      <div className="relative flex min-h-0 flex-1">
        <ResumeRail />
        <Outlet />
      </div>
    </div>
  )
}
