import type { Resume, ResumePatch } from "@workspace/resume-schema"
import { z } from "zod"

import type { TurnPlan } from "./chat"
import type { VersionSummary } from "./version"

export type SuggestionStatus = "pending" | "accepted" | "rejected" | "stale"

/** A decision the user can make. `stale` is the server's answer, not theirs. */
export type DecisionStatus = "accepted" | "rejected"

export type Suggestion = {
  id: string
  runId: string
  ordinal: number
  patch: ResumePatch
  status: SuggestionStatus
}

export type AgentRunStatus = "running" | "completed" | "failed" | "cancelled"

/**
 * Per-request inputs a run needs again on a client-tool continuation. Held on
 * the row only while the run is in flight and cleared when it finishes.
 */
export const RunInputSchema = z.object({
  /** Tailoring: ids only. The posting text lives on the `job_targets` row. */
  jobTargetId: z.string().optional(),
  sourceResumeId: z.string().optional(),
})
export type RunInput = z.infer<typeof RunInputSchema>

export type AgentRun = {
  id: string
  conversationId: string
  resumeId: string
  /**
   * The playbook the composer hinted at, or `TAILOR_SKILL_ID` for the
   * tailoring writer. Advisory: it is never enforced, and a turn that ignored
   * it is still a valid turn.
   */
  hintSkillId: string | null
  model: string
  selectedNodeId: string | null
  /** The snapshot taken before the run; what the patches were proposed against. */
  resumeVersionId: string | null
  /** The line the model planned with, when it called `plan`. */
  plan: TurnPlan | null
  /** The playbooks the model actually loaded, in order. Telemetry only. */
  skillIds: string[]
  /**
   * Whether the user enabled removing and restructuring for this turn. Kept on
   * the row so accept-time validation uses the value the patches were proposed
   * under, even if the panel's toggle has since changed.
   */
  structural: boolean
  /** The step budget ran out with nothing proposed. */
  budgetExhausted: boolean
  input: RunInput
  status: AgentRunStatus
  errorClass: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
  createdAt: string
}

export type SuggestionOutcome = {
  suggestionId: string
  status: SuggestionStatus
}

export type DecideResult = {
  head: Resume
  revision: number
  updatedAt: string
  version?: VersionSummary
  results: SuggestionOutcome[]
}
