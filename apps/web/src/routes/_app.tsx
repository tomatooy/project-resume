import { createFileRoute, Outlet } from "@tanstack/react-router"

import { AppHeader } from "@/features/shell/AppHeader"
import { ResumeRail } from "@/features/shell/ResumeRail"
import { getSession } from "@/lib/api"

export const Route = createFileRoute("/_app")({
  // Everything under here reads through `lib/api`, which is backed by
  // localStorage until the Worker lands. A localStorage store cannot serve an
  // SSR loader: the server seeds its own copy, so the record the loader
  // returns has different timestamps from the one the browser holds, and the
  // first autosave fails as a conflict against a document nobody else touched.
  // Rendering this subtree on the client keeps one store, one truth. Delete
  // this line when the server functions are real.
  ssr: false,
  // Supabase Auth replaces this call; the guard and redirect belong here.
  loader: () => getSession(),
  component: AppLayout,
})

function AppLayout() {
  const session = Route.useLoaderData()

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-canvas">
      <AppHeader email={session?.email ?? "you@example.com"} />
      <div className="relative flex min-h-0 flex-1">
        <ResumeRail />
        <Outlet />
      </div>
    </div>
  )
}
