import { createFileRoute, redirect } from "@tanstack/react-router"

/** History became the editor's Versions view; old links land there. */
export const Route = createFileRoute("/_app/r/$resumeId/history")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/r/$resumeId/edit",
      params,
      search: { view: "versions" },
    })
  },
})
