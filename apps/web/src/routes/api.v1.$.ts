import { createFileRoute } from "@tanstack/react-router"
import { handleApi } from "../server/api/handler"

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleApi(request),
      POST: ({ request }) => handleApi(request),
      OPTIONS: ({ request }) => handleApi(request),
    },
  },
})
