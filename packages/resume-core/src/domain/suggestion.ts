import type { Resume, ResumePatch } from "@workspace/resume-schema"

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

export type AgentRun = {
  id: string
  conversationId: string
  resumeId: string
  skillId: string
  model: string
  selectedNodeId: string | null
  status: AgentRunStatus
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
