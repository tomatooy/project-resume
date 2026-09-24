import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import { serve } from "../handler"

export const cancelChatRun = createServerFn({ method: "POST" })
  .validator(z.object({ runId: z.uuid() }))
  .handler(
    serve(async ({ services, data }) => {
      await services.runs.cancel(data.runId)
      return { ok: true }
    })
  )

/** One conversation per resume; created the first time the resume is opened. */
export const getOrCreateConversation = createServerFn({ method: "POST" })
  .validator(z.object({ resumeId: z.uuid() }))
  .handler(
    serve(({ services, data }) =>
      services.memory.openConversation(data.resumeId)
    )
  )

/**
 * Forgets the conversation: the transcript and every summary behind it. The
 * conversation row and the runs recorded against it stay.
 *
 * A run is closed first. A paused `check_fit` run is still `running` on the
 * server while the panel is idle, and it would refuse the next turn with
 * CONFLICT once the messages it resumes from are gone.
 */
export const clearConversation = createServerFn({ method: "POST" })
  .validator(z.object({ conversationId: z.uuid() }))
  .handler(
    serve(async ({ services, data }) => {
      await services.runs.cancelRunning(data.conversationId, "cleared")
      await services.memory.clearConversation(data.conversationId)
      return { ok: true as const }
    })
  )
