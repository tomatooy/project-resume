import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import { serve } from "../handler"

/**
 * Runs and suggestions are created by `/api/chat`, never from the browser:
 * a suggestion the server did not issue must not be acceptable later. The one
 * thing the browser decides is what to do with them.
 */
export const decideSuggestions = createServerFn({ method: "POST" })
  .validator(
    z.object({
      runId: z.uuid(),
      decisions: z.array(
        z.object({
          suggestionId: z.uuid(),
          status: z.enum(["accepted", "rejected"]),
        })
      ),
    })
  )
  .handler(serve(({ services, data }) => services.suggestions.decide(data)))
