import {
  ResumeService,
  SuggestionService,
  VersionService,
  type ConversationRepository,
} from "@workspace/resume-core"

import type { Db } from "./auth/supabase"
import { SupabaseAgentRunRepository } from "./adapters/agent-run-repository"
import { SupabaseConversationRepository } from "./adapters/conversation-repository"
import { SupabaseResumeRepository } from "./adapters/resume-repository"
import { SupabaseSuggestionRepository } from "./adapters/suggestion-repository"
import { SupabaseVersionRepository } from "./adapters/version-repository"

export type Services = {
  resumes: ResumeService
  versions: VersionService
  suggestions: SuggestionService
  conversations: ConversationRepository
}

/**
 * The composition root. This is the only file that knows both halves: which
 * concrete adapter implements which port, and how the services are wired to
 * them. Everything above it sees ports, and the test doubles in
 * `@workspace/resume-core/testing` drop into exactly the same slots.
 *
 * Built per request, because the client it is built from is per request.
 */
export function createServices(db: Db, userId: string): Services {
  const resumes = new SupabaseResumeRepository(db, userId)
  const versions = new SupabaseVersionRepository(db)
  const runs = new SupabaseAgentRunRepository(db)
  const suggestions = new SupabaseSuggestionRepository(db)

  return {
    resumes: new ResumeService(resumes),
    versions: new VersionService(resumes, versions),
    suggestions: new SuggestionService(resumes, runs, suggestions),
    conversations: new SupabaseConversationRepository(db, userId),
  }
}
