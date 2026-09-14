import { createFileRoute, redirect } from "@tanstack/react-router"

/** History became the Versions tab; old links land there. */
export const Route = createFileRoute("/_app/r/$resumeId/history")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/r/$resumeId/versions", params })
  },
})
