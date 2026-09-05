import { createModelsFromEnv } from "./ai"
import { createResumeParser, createSummarizer } from "@workspace/agent"
import {
  type ConversationRepository,
  ImportService,
  MemoryService,
  type MessageRepository,
  type ResumeParser,
  ResumeService,
  RunService,
  SuggestionService,
  type Summarizer,
  VersionService,
} from "@workspace/resume-core"

import type { Db } from "./auth/supabase"
import { SupabaseAgentRunRepository } from "./adapters/agent-run-repository"
import { SupabaseConversationRepository } from "./adapters/conversation-repository"
import { SupabaseMessageRepository } from "./adapters/message-repository"
import { SupabaseResumeRepository } from "./adapters/resume-repository"
import { SupabaseSuggestionRepository } from "./adapters/suggestion-repository"
import { SupabaseSummaryRepository } from "./adapters/summary-repository"
import { SupabaseVersionRepository } from "./adapters/version-repository"

export type Services = {
  resumes: ResumeService
  imports: ImportService
  versions: VersionService
  suggestions: SuggestionService
  conversations: ConversationRepository
  runs: RunService
  memory: MemoryService
  messages: MessageRepository
}

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
 * The composition root. This is the only file that knows both halves: which
 * concrete adapter implements which port, and how the services are wired to
 * them. Everything above it sees ports, and the test doubles in
 * `@workspace/resume-core/testing` drop into exactly the same slots.
 *
 * Built per request, because the client it is built from is per request.
 */
export function createServices(
  db: Db,
  userId: string,
  deps: { summarizer?: Summarizer; resumeParser?: ResumeParser } = {}
): Services {
  const resumes = new SupabaseResumeRepository(db, userId)
  const versions = new SupabaseVersionRepository(db)
  const runs = new SupabaseAgentRunRepository(db)
  const suggestions = new SupabaseSuggestionRepository(db)
  const messages = new SupabaseMessageRepository(db)
  const summaries = new SupabaseSummaryRepository(db)

  const versionService = new VersionService(resumes, versions)
  const resumeService = new ResumeService(resumes)

  return {
    resumes: resumeService,
    imports: new ImportService(
      deps.resumeParser ?? lazyResumeParser,
      resumeService,
      versionService
    ),
    versions: versionService,
    suggestions: new SuggestionService(resumes, runs, suggestions),
    conversations: new SupabaseConversationRepository(db, userId),
    runs: new RunService(versionService, runs),
    memory: new MemoryService(
      messages,
      summaries,
      deps.summarizer ?? lazySummarizer
    ),
    messages,
  }
}
