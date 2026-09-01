import type { Resume, ResumePatch } from "@workspace/resume-schema"
import type { TemplateId, TemplateOptions } from "@workspace/resume-render"

export type ResumeSummary = {
  id: string
  title: string
  /** Short line under the title in the rail, e.g. "Tailored · Senior PD". */
  subtitle: string
  templateId: TemplateId
  updatedAt: string
}

export type ResumeRecord = ResumeSummary & {
  data: Resume
  schemaVersion: number
  templateOptions: TemplateOptions
  currentVersionId: string | null
}

export type VersionSummary = {
  id: string
  versionNo: number
  label: string
  createdBy: "user" | "agent" | "system"
  createdAt: string
}

export type SuggestionStatus = "pending" | "accepted" | "rejected" | "stale"

export type Suggestion = {
  id: string
  runId: string
  patch: ResumePatch
  status: SuggestionStatus
}

export type RejectedSuggestion = {
  index: number
  code: string
  message: string
}

export type SkillId =
  | "bullet_rewrite"
  | "jd_match"
  | "grammar_clarity"
  | "condense_to_pages"
  | "ats_keyword"
  | "impact_quantification"
  | "summary_optimize"

export type DecideResult = {
  head: Resume
  updatedAt: string
  version?: VersionSummary
  results: { suggestionId: string; status: SuggestionStatus }[]
}

export class ApiError extends Error {
  constructor(
    readonly code:
      | "UNAUTHENTICATED"
      | "NOT_FOUND"
      | "CONFLICT"
      | "VALIDATION"
      | "RATE_LIMITED"
      | "INTERNAL",
    message: string,
    readonly status = 500
  ) {
    super(message)
    this.name = "ApiError"
  }
}
