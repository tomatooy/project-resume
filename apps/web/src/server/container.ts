import { SupabaseTailorOperationRepository } from "./adapters/tailor-operation-repository"
import {
  createAutofillModels,
  createJobParser,
  createResumeParser,
  createResumeTailor,
  createSummarizer,
} from "@workspace/agent"
import {
  type AutofillModels,
  type JobParser,
  type Ports,
  type ResumeParser,
  type ResumeTailor,
  type Summarizer,
  createServices,
} from "@workspace/resume-core"

import { SupabaseAgentRunRepository } from "./adapters/agent-run-repository"
import { SupabaseAutofillApplicationRepository } from "./adapters/autofill-application-repository"
import { SupabaseAutofillNotesRepository } from "./adapters/autofill-notes-repository"
import { SupabaseAutofillProfileRepository } from "./adapters/autofill-profile-repository"
import { SupabaseConversationRepository } from "./adapters/conversation-repository"
import { WorkerJobFetcher } from "./adapters/job-fetcher"
import { SupabaseJobTargetRepository } from "./adapters/job-target-repository"
import { SupabaseMessageRepository } from "./adapters/message-repository"
import { SupabaseResumeRepository } from "./adapters/resume-repository"
import { SupabaseSkillRepository } from "./adapters/skill-repository"
import { SupabaseSuggestionRepository } from "./adapters/suggestion-repository"
import { SupabaseSummaryRepository } from "./adapters/summary-repository"
import { SupabaseVersionRepository } from "./adapters/version-repository"
import { createModelsFromEnv } from "./ai"
import { traceAutofillModels, traceJevClient } from "./autofill-trace"
import type { Db } from "./auth/supabase"
import { createLogger } from "./log"
import { createTypeSafeClientFromEnv } from "./typesafe"

export type { Services } from "@workspace/resume-core"
export { createServices }

const AUTOFILL_TRACE = import.meta.env.DEV && import.meta.env.MODE !== "test"

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

/** Same reason as the summarizer: only tailoring needs the key. */
const lazyJobParser: JobParser = {
  async parse(input) {
    const startedAt = Date.now()
    try {
      return await createJobParser(createModelsFromEnv()).parse(input)
    } finally {
      createLogger().info("tailor_job_parse_duration", {
        latencyMs: Date.now() - startedAt,
      })
    }
  },
}

const lazyResumeTailor: ResumeTailor = {
  async tailor(input) {
    const startedAt = Date.now()
    try {
      return await createResumeTailor(createModelsFromEnv()).tailor(input)
    } finally {
      createLogger().info("tailor_resume_generate_duration", {
        latencyMs: Date.now() - startedAt,
      })
    }
  },
}

const jobFetcher = new WorkerJobFetcher()

/** A missing key is a configuration error class, never a throw (spec 12.1). */
function missingKey(errorClass: "deepseek_missing" | "typesafe_missing"): null {
  createLogger().error("autofill_config", { errorClass })
  return null
}

/**
 * Autofill's models, built on first use and kept for the request. A missing
 * DeepSeek or TypeSafe key leaves that client null, so `ready()` reports it
 * and `infer` degrades to rules and plain questions instead of failing.
 */
export function lazyAutofillModels(): AutofillModels {
  let built: AutofillModels | null = null
  const models = (): AutofillModels => {
    if (built) return built
    const typesafe = process.env.TYPESAFE_API_KEY?.trim()
      ? createTypeSafeClientFromEnv()
      : missingKey("typesafe_missing")
    built = createAutofillModels({
      models: process.env.DEEPSEEK_API_KEY
        ? createModelsFromEnv()
        : missingKey("deepseek_missing"),
      typesafe:
        typesafe && AUTOFILL_TRACE ? traceJevClient(typesafe) : typesafe,
    })
    return built
  }
  return {
    get model() {
      return models().model
    },
    ready: () => models().ready(),
    judge: (input) => models().judge(input),
    shortText: (input) => models().shortText(input),
    questions: (input) => models().questions(input),
    fillFromAnswer: (input) => models().fillFromAnswer(input),
    mergeNotes: (input) => models().mergeNotes(input),
    generate: (input) => models().generate(input),
  }
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
    operations: new SupabaseTailorOperationRepository(db, userId),
    resumes: new SupabaseResumeRepository(db, userId),
    versions: new SupabaseVersionRepository(db),
    runs: new SupabaseAgentRunRepository(db),
    suggestions: new SupabaseSuggestionRepository(db),
    conversations: new SupabaseConversationRepository(db, userId),
    messages: new SupabaseMessageRepository(db),
    summaries: new SupabaseSummaryRepository(db),
    summarizer: lazySummarizer,
    resumeParser: lazyResumeParser,
    jobTargets: new SupabaseJobTargetRepository(db, userId),
    jobParser: lazyJobParser,
    resumeTailor: lazyResumeTailor,
    jobFetcher,
    skills: new SupabaseSkillRepository(db, userId),
    autofillProfiles: new SupabaseAutofillProfileRepository(db, userId),
    autofillNotes: new SupabaseAutofillNotesRepository(db, userId),
    autofillApplications: new SupabaseAutofillApplicationRepository(db, userId),
    // Applicant records and model answers: `vite dev` only.
    autofillModels: AUTOFILL_TRACE
      ? traceAutofillModels(lazyAutofillModels())
      : lazyAutofillModels(),
    ...over,
  }
}
