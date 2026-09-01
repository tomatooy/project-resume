import { createFileRoute } from "@tanstack/react-router"

import { InterviewScreen } from "@/features/interview/InterviewScreen"

export const Route = createFileRoute("/_app/r/$resumeId/interview")({
  component: InterviewScreen,
})
