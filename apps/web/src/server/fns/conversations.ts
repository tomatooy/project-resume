import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import { serve } from "../handler"

/** One conversation per resume; created the first time the resume is opened. */
export const getOrCreateConversation = createServerFn({ method: "POST" })
  .validator(z.object({ resumeId: z.uuid() }))
  .handler(
    serve(({ services, data }) =>
      services.conversations.getOrCreate(data.resumeId)
    )
  )
