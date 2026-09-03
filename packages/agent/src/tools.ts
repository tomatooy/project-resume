import {
  CheckFitOutputSchema,
  type ProposeOutput,
  ProposeOutputSchema,
  type ProposedSuggestion,
} from "@workspace/resume-core"
import {
  type Resume,
  type ResumePatch,
  type ValidationContext,
  validatePatches,
} from "@workspace/resume-schema"
import { tool } from "ai"
import { z } from "zod"

/** Stores the valid patches for the run and returns them with their ids. */
export type PersistProposal = (
  valid: ResumePatch[]
) => Promise<ProposedSuggestion[]>

/**
 * No `execute`: the browser renders the document and answers with the page
 * count, then sends the conversation back for the next step.
 */
export const checkFitTool = tool({
  description:
    "Render the resume with the given patches applied and return the page count. Use before proposing when a page target exists.",
  inputSchema: z.object({ patches: z.array(z.unknown()).max(50) }),
  outputSchema: CheckFitOutputSchema,
})

export type ProposeToolDeps = {
  skillId: string
  runId: string
  resume: Resume
  validation: ValidationContext
  persist: PersistProposal
}

/**
 * The deterministic gate between the model and the database. Whatever the
 * model sends goes through `validatePatches`; only what survives is stored,
 * and the model is told exactly what was refused and why.
 */
export function proposePatchesTool(deps: ProposeToolDeps) {
  return tool({
    description:
      "Submit the final list of patches. Call once at the end, after any check_fit calls.",
    inputSchema: z.object({
      patches: z.array(z.unknown()).max(50),
      gaps: z.array(z.string().max(300)).max(20).optional(),
      followUpQuestion: z.string().max(500).optional(),
    }),
    outputSchema: ProposeOutputSchema,
    execute: async ({ patches, gaps, followUpQuestion }) => {
      // The skill is a server fact, not something the model states.
      const stamped = patches.map((patch) =>
        patch !== null && typeof patch === "object"
          ? { ...patch, skillId: deps.skillId }
          : patch
      )
      const { valid, rejected } = validatePatches(
        deps.resume,
        stamped,
        deps.validation
      )
      const suggestions = await deps.persist(valid)
      const output: ProposeOutput = {
        runId: deps.runId,
        suggestions,
        rejected,
        gaps: gaps ?? [],
      }
      if (followUpQuestion) output.followUpQuestion = followUpQuestion
      return output
    },
  })
}
