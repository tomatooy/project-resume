import { createServerFn } from "@tanstack/react-start"
import type { DecideResult } from "@workspace/resume-core"
import { z } from "zod"

import { withSupabase } from "../handler"

/**
 * Runs and suggestions are created by `/api/chat`, never from the browser:
 * a suggestion the server did not issue must not be acceptable later. The one
 * thing the browser decides is what to do with them.
 */
const decideInput = z.object({
  runId: z.uuid(),
  decisions: z.array(
    z.object({
      suggestionId: z.uuid(),
      status: z.enum(["accepted", "rejected"]),
    })
  ),
})

export const decideSuggestions = createServerFn({ method: "POST" })
  .validator(decideInput)
  .handler(
    withSupabase<z.infer<typeof decideInput>, DecideResult>(
      ({ services, data }) => services.suggestions.decide(data)
    )
  )
