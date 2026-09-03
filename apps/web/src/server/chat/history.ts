import { toUIMessage } from "@workspace/agent"
import type { SuggestionStatus } from "@workspace/resume-core"
import type { UIMessage } from "ai"
import { z } from "zod"

import type { Services } from "../container"

export type ChatHistory = {
  messages: UIMessage[]
  /** Status by suggestion id, for every card in `messages`. */
  suggestions: Record<string, SuggestionStatus>
}

const HistoryQuerySchema = z.object({
  conversationId: z.uuid(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

/**
 * What the assistant panel loads on open. A card's patch is stored inside its
 * message; its status is not, because the row changes when the user decides,
 * so the statuses are fetched alongside and merged in the browser.
 */
export async function loadHistory(
  services: Services,
  request: Request
): Promise<ChatHistory> {
  const url = new URL(request.url)
  const query = HistoryQuerySchema.parse({
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
