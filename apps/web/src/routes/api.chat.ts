import { createFileRoute } from "@tanstack/react-router"

import { withChat } from "@/server/chat/deps"
import { handleChat } from "@/server/chat/handle-chat"
import { loadHistory } from "@/server/chat/history"

/**
 * A server route rather than a server function, for two reasons: the reply is
 * a stream `useChat` reads incrementally, and the history carries patches
 * whose `update_fields` payload is `Record<string, unknown>`, which the
 * server-function serializer refuses on principle.
 */
export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      GET: ({ request }) =>
        withChat(async ({ services }) =>
          Response.json(await loadHistory(services, request))
        ),
      POST: ({ request }) => withChat((deps) => handleChat(deps, request)),
    },
  },
})
