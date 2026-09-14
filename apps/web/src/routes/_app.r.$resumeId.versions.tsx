import { createFileRoute } from "@tanstack/react-router"

import { VersionsPanel } from "@/features/versions/VersionsPanel"

export const Route = createFileRoute("/_app/r/$resumeId/versions")({
  component: VersionsPanel,
})
