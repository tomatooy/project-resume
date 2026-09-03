import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import { withSupabase } from "../handler"

const conversationInput = z.object({ resumeId: z.uuid() })

/** One conversation per resume; created the first time the resume is opened. */
export const getOrCreateConversation = createServerFn({ method: "POST" })
  .validator(conversationInput)
  .handler(
    withSupabase<z.infer<typeof conversationInput>, { id: string }>(
      ({ services, data }) => services.conversations.getOrCreate(data.resumeId)
    )
  )
