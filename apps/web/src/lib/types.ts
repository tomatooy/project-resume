/**
 * The application's view of the domain.
 *
 * The types themselves live in `@workspace/resume-core`, which is where the
 * services that produce them live. They are re-exported here so screens keep
 * importing from one place, and so this file stays the answer to "what does the
 * browser know about".
 */
export type {
  AgentRun,
  DecideResult,
  ResumeRecord,
  ResumeSearch,
  ResumeSearchGroup,
  ResumeSummary,
  Suggestion,
  SuggestionStatus,
  TailorFromJobResult,
  TextRange,
  VersionSummary,
} from "@workspace/resume-core"

/**
 * The playbook catalog is the agent package's, not the domain's: a playbook is
 * prompt text, so its type lives next to the library that holds it.
 */
export type { SkillId } from "@/lib/skills"

/**
 * The chat route's wire shapes come from the contract the route itself parses
 * against, so the panel and the server cannot drift apart.
 */
export type {
  ChatHistory,
  ChatTurnInputs,
  ChatUIMessage,
} from "@/server/chat/contract"

/**
 * The browser's error type.
 *
 * It exists separately from `AppError` because an error that crosses a server
 * function boundary is serialized: what arrives is a plain `Error` carrying the
 * same `code`, not an instance of the class that was thrown. `lib/api.ts`
 * rebuilds one of these from it, which is what lets `store.ts` keep asking
 * `error instanceof ApiError && error.code === "CONFLICT"`.
 */
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
