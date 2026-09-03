import type { Resume, ResumePatch } from "@workspace/resume-schema"

import type { SuggestionStatus, Suggestion } from "../domain/suggestion"
import type { VersionSummary } from "../domain/version"

export type NewSuggestion = {
  ordinal: number
  patch: ResumePatch
  targetNodeId: string
}

export type SuggestionDecision = {
  suggestionId: string
  status: Exclude<SuggestionStatus, "pending">
}

export type DecideInput = {
  runId: string
  decisions: SuggestionDecision[]
  /** The already-patched document, or null when nothing was accepted. */
  newContent: Resume | null
  contentHash: string | null
}

export type DecideOutcome = {
  version: VersionSummary | null
  revision: number
  updatedAt: string
}

export interface SuggestionRepository {
  insertMany(
    runId: string,
    resumeId: string,
    suggestions: NewSuggestion[]
  ): Promise<Suggestion[]>
  listForRun(runId: string): Promise<Suggestion[]>
  /** Every suggestion of these runs, in one query; for hydrating a history. */
  listForRuns(runIds: string[]): Promise<Suggestion[]>
  /**
   * Records every decision and, when anything was accepted, creates the
   * resulting version. One transaction: a suggestion must never end up marked
   * accepted with no version to show for it.
   */
  decide(input: DecideInput): Promise<DecideOutcome>
}
