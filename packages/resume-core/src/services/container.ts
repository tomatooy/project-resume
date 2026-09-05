import type { AgentRunRepository } from "../ports/agent-run-repository"
import type { ConversationRepository } from "../ports/conversation-repository"
import type { MessageRepository } from "../ports/message-repository"
import type { ResumeParser } from "../ports/resume-parser"
import type { ResumeRepository } from "../ports/resume-repository"
import type { SuggestionRepository } from "../ports/suggestion-repository"
import type { Summarizer } from "../ports/summarizer"
import type { SummaryRepository } from "../ports/summary-repository"
import type { VersionRepository } from "../ports/version-repository"
import { ImportService } from "./import-service"
import { MemoryService } from "./memory-service"
import { ResumeService } from "./resume-service"
import { RunService } from "./run-service"
import { SuggestionService } from "./suggestion-service"
import { VersionService } from "./version-service"

/** Everything the services need from outside: one adapter per port. */
export type Ports = {
  resumes: ResumeRepository
  versions: VersionRepository
  runs: AgentRunRepository
  suggestions: SuggestionRepository
  conversations: ConversationRepository
  messages: MessageRepository
  summaries: SummaryRepository
  summarizer: Summarizer
  resumeParser: ResumeParser
  /** Injected so a test can move time; wall clock otherwise. */
  clock?: () => Date
}

/** What a request handler sees. Services only; no port reaches this altitude. */
export type Services = {
  resumes: ResumeService
  imports: ImportService
  versions: VersionService
  suggestions: SuggestionService
  runs: RunService
  memory: MemoryService
}

/**
 * How the services hang together, written once. An adapter set (Supabase
 * per request, in-memory in a test) plugs in below this line and nothing
 * above it knows which.
 */
export function createServices(ports: Ports): Services {
  const versions = new VersionService(ports.resumes, ports.versions)
  const resumes = new ResumeService(ports.resumes)
  return {
    resumes,
    imports: new ImportService(ports.resumeParser, resumes, versions),
    versions,
    suggestions: new SuggestionService(
      ports.resumes,
      ports.runs,
      ports.suggestions
    ),
    runs: new RunService(versions, ports.runs, ports.clock),
    memory: new MemoryService(
      ports.conversations,
      ports.messages,
      ports.summaries,
      ports.summarizer
    ),
  }
}
