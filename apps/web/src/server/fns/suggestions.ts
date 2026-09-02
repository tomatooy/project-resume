import { createServerFn } from "@tanstack/react-start"
import { ResumePatchSchema } from "@workspace/resume-schema"
import type { AgentRun, DecideResult } from "@workspace/resume-core"
import { z } from "zod"

import { withSupabase } from "../handler"

const conversationInput = z.object({ resumeId: z.uuid() })

export const getOrCreateConversation = createServerFn({ method: "POST" })
  .validator(conversationInput)
  .handler(
    withSupabase<z.infer<typeof conversationInput>, { id: string }>(
      ({ services, data }) => services.conversations.getOrCreate(data.resumeId)
    )
  )

const runInput = z.object({
  conversationId: z.uuid(),
  resumeId: z.uuid(),
  skillId: z.string(),
  model: z.string(),
  selectedNodeId: z.string().nullable().optional(),
})

export const createRun = createServerFn({ method: "POST" })
  .validator(runInput)
  .handler(
    withSupabase<z.infer<typeof runInput>, AgentRun>(({ services, data }) =>
      services.suggestions.createRun(data)
    )
  )

const saveInput = z.object({
  runId: z.uuid(),
  patches: z.array(ResumePatchSchema),
})

/**
 * Only the assigned id and ordinal come back, not the stored suggestion.
 *
 * Two reasons. The caller supplied the patches, so echoing them is pure weight
 * on the wire. And a patch's `update_fields` payload is `Record<string,
 * unknown>`, which Start's return-value serialization check rightly refuses:
 * `unknown` is not provably serializable, and widening the patch contract to
 * satisfy a transport is the wrong direction.
 */
export type SavedSuggestion = { id: string; ordinal: number }

/**
 * Ids are assigned here, not in the browser. A suggestion the server never
 * issued must not be acceptable later, and the ordinal the patches are stored
 * with is what fixes the order they are re-applied in.
 */
export const saveSuggestions = createServerFn({ method: "POST" })
  .validator(saveInput)
  .handler(
    withSupabase<z.infer<typeof saveInput>, SavedSuggestion[]>(
      async ({ services, data }) => {
        const saved = await services.suggestions.persistProposal(
          data.runId,
          data.patches
        )
        return saved.map(({ id, ordinal }) => ({ id, ordinal }))
      }
    )
  )

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
