import { toUIMessage } from "@workspace/agent"
import type { UIMessage } from "ai"

import type { Services } from "../container"
import { parseRequest } from "../errors"
import { type ChatHistory, HistoryQuerySchema } from "./contract"

/**
 * What the assistant panel loads on open. A card's patch is stored inside its
 * message; its status is not, because the row changes when the user decides,
 * so the statuses are fetched alongside and merged in the browser.
 */
export async function loadHistory(
  services: Services,
  request: Request
): Promise<ChatHistory<UIMessage>> {
  const url = new URL(request.url)
  const query = parseRequest(HistoryQuerySchema, {
    conversationId: url.searchParams.get("conversationId") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  })

  const history = await services.memory.history(
    query.conversationId,
    query.limit
  )
  const runIds = new Set<string>()
  for (const message of history) {
    if (message.agentRunId && message.role === "assistant") {
      runIds.add(message.agentRunId)
    }
  }
  const suggestions = await services.suggestions.statusesForRuns([...runIds])
  return { messages: history.map(toUIMessage), suggestions }
}
