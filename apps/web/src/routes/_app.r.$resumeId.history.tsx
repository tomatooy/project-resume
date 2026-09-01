import { createFileRoute } from "@tanstack/react-router"

import { HistoryScreen } from "@/features/history/HistoryScreen"

export const Route = createFileRoute("/_app/r/$resumeId/history")({
  component: HistoryScreen,
})
