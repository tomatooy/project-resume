import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/r/$resumeId/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/r/$resumeId/edit", params })
  },
})
