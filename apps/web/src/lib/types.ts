/**
 * The application's view of the domain.
 *
 * The types themselves live in `@workspace/resume-core`, which is where the
 * services that produce them live. They are re-exported here so screens keep
 * importing from one place, and so this file stays the answer to "what does the
 * browser know about".
 */
import type { AgentTools } from "@workspace/agent"
import type {
  MessageMetadata,
  SuggestionStatus as SuggestionStatusType,
} from "@workspace/resume-core"
import type { InferUITools, UIDataTypes, UIMessage } from "ai"

export type {
  AgentRun,
  DecideResult,
  ResumeRecord,
  ResumeSummary,
  SkillId,
  Suggestion,
  SuggestionStatus,
  VersionSummary,
} from "@workspace/resume-core"

/**
 * A conversation message as `useChat` holds it: the assistant's tool parts
 * are typed from the same tool definitions the server streams from, so a
 * `tool-propose_patches` part's output is a `ProposeOutput` here too.
 */
export type ChatUIMessage = UIMessage<
  MessageMetadata,
  UIDataTypes,
  InferUITools<AgentTools>
>

/** What the chat route's GET answers: the transcript plus card statuses. */
export type ChatHistory = {
  messages: ChatUIMessage[]
  suggestions: Record<string, SuggestionStatusType>
}

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
