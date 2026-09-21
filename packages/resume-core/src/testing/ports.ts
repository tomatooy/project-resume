import type { Ports } from "../services/container"
import { InMemoryDb } from "./db"
import { InMemoryAgentRunRepository } from "./in-memory-agent-run-repository"
import { InMemoryConversationRepository } from "./in-memory-conversation-repository"
import { InMemoryJobTargetRepository } from "./in-memory-job-target-repository"
import { InMemoryMessageRepository } from "./in-memory-message-repository"
import { InMemoryResumeRepository } from "./in-memory-resume-repository"
import { InMemorySkillRepository } from "./in-memory-skill-repository"
import { InMemorySuggestionRepository } from "./in-memory-suggestion-repository"
import { InMemorySummaryRepository } from "./in-memory-summary-repository"
import { InMemoryVersionRepository } from "./in-memory-version-repository"
import { StubJobFetcher } from "./stub-job-fetcher"
import { StubJobParser } from "./stub-job-parser"
import { StubResumeParser } from "./stub-resume-parser"
import { StubResumeTailor } from "./stub-resume-tailor"
import { StubSummarizer } from "./stub-summarizer"

/**
 * Every port on one in-memory database, typed concretely so a test can still
 * reach a double's own controls (the summarizer's calls, the parser's next
 * answer) while handing the whole set to `createServices`.
 */
export function inMemoryPorts(db = new InMemoryDb()) {
  return {
    db,
    resumes: new InMemoryResumeRepository(db),
    versions: new InMemoryVersionRepository(db),
    runs: new InMemoryAgentRunRepository(db),
    suggestions: new InMemorySuggestionRepository(db),
    conversations: new InMemoryConversationRepository(db),
    messages: new InMemoryMessageRepository(db),
    summaries: new InMemorySummaryRepository(db),
    summarizer: new StubSummarizer(),
    resumeParser: new StubResumeParser(),
    jobTargets: new InMemoryJobTargetRepository(db),
    jobParser: new StubJobParser(),
    resumeTailor: new StubResumeTailor(),
    jobFetcher: new StubJobFetcher(),
    skills: new InMemorySkillRepository(db),
    clock: () => db.now(),
  } satisfies Ports & { db: InMemoryDb }
}
