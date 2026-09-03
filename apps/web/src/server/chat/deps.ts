import { createSummarizer } from "@workspace/agent"

import { createModelsFromEnv } from "../ai"
import { requireUser } from "../auth/require-user"
import { createSupabaseForRequest } from "../auth/supabase"
import { createBackground } from "../background"
import { createServices } from "../container"
import { createLogger } from "../log"
import { errorResponse } from "./errors"
import type { ChatDeps } from "./handle-chat"

/**
 * The server-route counterpart of `withSupabase`: authenticate, build the
 * services and models for this request, hand them to the handler, and turn
 * anything thrown before a response exists into the JSON error shape.
 */
export async function withChat(
  handler: (deps: ChatDeps) => Promise<Response>
): Promise<Response> {
  const requestId = crypto.randomUUID()
  let log = createLogger({ requestId })
  try {
    const db = createSupabaseForRequest()
    const user = await requireUser(db)
    log = createLogger({ requestId, userId: user.userId })

    const models = createModelsFromEnv()
    const services = createServices(db, user.userId, {
      summarizer: createSummarizer(models),
    })
    return await handler({
      services,
      models,
      background: createBackground(log),
      log,
      now: () => new Date(),
    })
  } catch (error) {
    return errorResponse(error, log)
  }
}
