import { createResumeParser, createSummarizer } from "@workspace/agent"
import {
  type Ports,
  type ResumeParser,
  type Summarizer,
  createServices,
} from "@workspace/resume-core"

import { SupabaseAgentRunRepository } from "./adapters/agent-run-repository"
import { SupabaseConversationRepository } from "./adapters/conversation-repository"
import { SupabaseMessageRepository } from "./adapters/message-repository"
import { SupabaseResumeRepository } from "./adapters/resume-repository"
import { SupabaseSuggestionRepository } from "./adapters/suggestion-repository"
import { SupabaseSummaryRepository } from "./adapters/summary-repository"
import { SupabaseVersionRepository } from "./adapters/version-repository"
import { createModelsFromEnv } from "./ai"
import type { Db } from "./auth/supabase"

export type { Services } from "@workspace/resume-core"
export { createServices }

/**
 * Builds the model client only if consolidation actually runs, so a server
 * function that never touches memory does not need an AI key to be present.
 */
const lazySummarizer: Summarizer = {
  summarize: (input) =>
    createSummarizer(createModelsFromEnv()).summarize(input),
}

/** Same reason as the summarizer: only import needs the key, so only import pays. */
const lazyResumeParser: ResumeParser = {
  parse: (input) => createResumeParser(createModelsFromEnv()).parse(input),
}

/**
 * The adapter half of the composition root: which Supabase class fills which
 * port. How the services hang off the ports is `createServices`, written
 * once in `resume-core` and shared with the in-memory set the tests use.
 *
 * Built per request, because the client it is built from is per request.
 * `over` lets the chat route swap in the summarizer it already built.
 */
export function supabasePorts(
  db: Db,
  userId: string,
  over: Partial<Ports> = {}
): Ports {
  return {
    resumes: new SupabaseResumeRepository(db, userId),
    versions: new SupabaseVersionRepository(db),
    runs: new SupabaseAgentRunRepository(db),
    suggestions: new SupabaseSuggestionRepository(db),
    conversations: new SupabaseConversationRepository(db, userId),
    messages: new SupabaseMessageRepository(db),
    summaries: new SupabaseSummaryRepository(db),
    summarizer: lazySummarizer,
    resumeParser: lazyResumeParser,
    ...over,
  }
}
