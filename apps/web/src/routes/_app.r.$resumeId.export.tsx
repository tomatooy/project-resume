import { createFileRoute } from "@tanstack/react-router"

import { ExportScreen } from "@/features/export/ExportScreen"

export const Route = createFileRoute("/_app/r/$resumeId/export")({
  component: ExportScreen,
})
