import type { Resume, ResumePatch } from "@workspace/resume-schema"
import { z } from "zod"

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
 * the row only while the run is in flight and cleared when it finishes, so a
 * pasted job description is not retained.
 */
export const RunInputSchema = z.object({
  jobDescription: z.string().optional(),
  targetPages: z.number().int().optional(),
  /** Tailoring: ids only. The posting text lives on the `job_targets` row. */
  jobTargetId: z.string().optional(),
  sourceResumeId: z.string().optional(),
})
export type RunInput = z.infer<typeof RunInputSchema>

export type AgentRun = {
  id: string
  conversationId: string
  resumeId: string
  skillId: string
  model: string
  selectedNodeId: string | null
  /** The snapshot taken before the run; what the patches were proposed against. */
  resumeVersionId: string | null
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
