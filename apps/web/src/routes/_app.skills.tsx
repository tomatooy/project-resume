import { ResourceFailure } from "@/features/workspace/ResourceFailure"
import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/skills")({
  component: Outlet,
  errorComponent: ResourceFailure,
})
