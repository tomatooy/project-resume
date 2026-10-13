import {
  AutofillProfileService,
  type AutofillProfileRepository,
} from "../autofill-profile/service"
import { AutofillService } from "../autofill/planner"
import {
  ScopedAnswerService,
  type ScopedAnswerRepository,
} from "../autofill/answers"
import type {
  AutofillDrafter,
  AutofillPageInterpreter,
} from "../autofill/interpreter-port"
import type {
  AutofillDecider,
  AutofillQuota,
  AutofillPolicyProvider,
} from "../autofill/ports"
import type { TailorOperationRepository } from "../ports/tailor-operation-repository"
import { TailorOperationService } from "./tailor-operation-service"
import type { AgentRunRepository } from "../ports/agent-run-repository"
import type { ConversationRepository } from "../ports/conversation-repository"
import type { JobFetcher } from "../ports/job-fetcher"
import type { JobParser } from "../ports/job-parser"
import type { JobTargetRepository } from "../ports/job-target-repository"
import type { MessageRepository } from "../ports/message-repository"
import type { ResumeParser } from "../ports/resume-parser"
import type { ResumeRepository } from "../ports/resume-repository"
import type { ResumeTailor } from "../ports/resume-tailor"
import type { SkillRepository } from "../ports/skill-repository"
import type { SuggestionRepository } from "../ports/suggestion-repository"
import type { Summarizer } from "../ports/summarizer"
import type { SummaryRepository } from "../ports/summary-repository"
import type { VersionRepository } from "../ports/version-repository"
import { ImportService } from "./import-service"
import { MemoryService } from "./memory-service"
import { ResumeService } from "./resume-service"
import { RunService } from "./run-service"
import { SkillService } from "./skill-service"
import { SuggestionService } from "./suggestion-service"
import { TailorService } from "./tailor-service"
import { VersionService } from "./version-service"

/** Everything the services need from outside: one adapter per port. */
export type Ports = {
  autofillProfiles: AutofillProfileRepository
  autofillAnswers?: ScopedAnswerRepository
  autofillInterpreter?: AutofillPageInterpreter
  autofillDrafter?: AutofillDrafter
  autofillDecider: AutofillDecider
  autofillQuota: AutofillQuota
  autofillPolicy: AutofillPolicyProvider
  resumes: ResumeRepository
  versions: VersionRepository
  runs: AgentRunRepository
  suggestions: SuggestionRepository
  conversations: ConversationRepository
  messages: MessageRepository
  summaries: SummaryRepository
  summarizer: Summarizer
  resumeParser: ResumeParser
  jobTargets: JobTargetRepository
  jobParser: JobParser
  resumeTailor: ResumeTailor
  jobFetcher: JobFetcher
  operations: TailorOperationRepository
  skills: SkillRepository
  /** Injected so a test can move time; wall clock otherwise. */
  clock?: () => Date
}

/** What a request handler sees. Services only; no port reaches this altitude. */
export type Services = {
  autofillProfile: AutofillProfileService
  autofillAnswers: ScopedAnswerService
  autofill: AutofillService
  resumes: ResumeService
  imports: ImportService
  versions: VersionService
  suggestions: SuggestionService
  runs: RunService
  memory: MemoryService
  tailor: TailorService
  operations: TailorOperationService
  skills: SkillService
}

/**
 * How the services hang together, written once. An adapter set (Supabase
 * per request, in-memory in a test) plugs in below this line and nothing
 * above it knows which.
 */
export function createServices(ports: Ports): Services {
  const autofillProfile = new AutofillProfileService(
    ports.autofillProfiles,
    ports.clock
  )
  const versions = new VersionService(ports.resumes, ports.versions)
  const autofillAnswers = new ScopedAnswerService(
    ports.autofillAnswers,
    ports.clock
  )
  const resumes = new ResumeService(ports.resumes)
  const runs = new RunService(versions, ports.runs, ports.clock)
  const memory = new MemoryService(
    ports.conversations,
    ports.messages,
    ports.summaries,
    ports.summarizer
  )
  return {
    autofillProfile,
    autofillAnswers,
    autofill: new AutofillService(
      ports.resumes,
      ports.versions,
      autofillProfile,
      ports.autofillDecider,
      ports.autofillQuota,
      ports.autofillPolicy,
      ports.clock,
      autofillAnswers,
      ports.autofillInterpreter,
      ports.autofillDrafter
    ),
    resumes,
    imports: new ImportService(ports.resumeParser, resumes, versions),
    versions,
    suggestions: new SuggestionService(
      ports.resumes,
      ports.runs,
      ports.suggestions
    ),
    runs,
    memory,
    tailor: new TailorService(
      ports.jobParser,
      ports.resumeTailor,
      ports.jobTargets,
      resumes,
      versions,
      runs,
      memory,
      ports.jobFetcher,
      ports.operations
    ),
    operations: new TailorOperationService(
      ports.operations,
      ports.resumes,
      ports.versions,
      ports.jobTargets,
      ports.jobParser,
      ports.resumeTailor,
      ports.clock
    ),
    skills: new SkillService(ports.skills),
  }
}
