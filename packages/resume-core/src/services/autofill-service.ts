import {
  applicantContext,
  type ContextInput,
  companiesMatch,
  missingAnswers,
  plainQuestions,
  resumeFileName,
  ruleFills,
} from "@workspace/autofill"

import type {
  AiRequest,
  AutofillPage,
  InferInput,
  InferResult,
  JobMatch,
  PlanInput,
  PlanResult,
  ResumeChoice,
  StartInput,
  StartResult,
} from "../domain/autofill"
import { AppError } from "../domain/errors"
import type { JobIdentity } from "../domain/job-identity"
import type { JobBrief, ResumeRecord } from "../domain/resume"
import type { AutofillApplicationRepository } from "../ports/autofill-application-repository"
import type {
  AutofillModels,
  JudgeOutput,
  ModelCall,
  ModelUsage,
  ShortTextOutput,
} from "../ports/autofill-models"
import type { JobTargetRepository } from "../ports/job-target-repository"
import type { ResumeRepository } from "../ports/resume-repository"
import type { TailorOperationRepository } from "../ports/tailor-operation-repository"
import type { AutofillNotesService } from "./autofill-notes-service"
import type { AutofillProfileService } from "./autofill-profile-service"
import {
  aiFields,
  INFER_MS,
  JUDGE_MS,
  type KeyedField,
  keyFields,
  modelInputs,
  questionFields,
  questionList,
  settle,
} from "./autofill-tiers"
import type { RunService } from "./run-service"
import type { VersionService } from "./version-service"

/** How many recent origin links the company rule looks through. */
const ORIGINS_SCANNED = 50

/** The judge sees no page text (spec 12.1): its answers fill fields directly. */
const NO_PAGE = { company: null, title: null }

const NO_USAGE: ModelUsage = { inputTokens: 0, outputTokens: 0 }
/** What a call that had nothing to ask returns, without being made. */
const NOTHING_JUDGED: JudgeOutput = {
  choices: {},
  multi: {},
  open: {},
  usage: NO_USAGE,
}
const NOTHING_ANSWERED: ShortTextOutput = { answers: [], usage: NO_USAGE }

/** Why the judge and short text step failed, as the run row records it. */
type StepFailure = "timeout" | "model"

type Inferred = {
  result: Omit<InferResult, "quota">
  failure: StepFailure | null
}

export type AutofillDeps = {
  resumes: ResumeRepository
  versions: VersionService
  runs: RunService
  jobTargets: JobTargetRepository
  operations: TailorOperationRepository
  profiles: AutofillProfileService
  notes: AutofillNotesService
  applications: AutofillApplicationRepository
  models: AutofillModels
  clock: () => Date
}

type Chosen = { record: ResumeRecord; choice: ResumeChoice }

/**
 * The server side of an autofill session: the free `plan` and `start`, and
 * the metered AI calls that follow them.
 */
export class AutofillService {
  constructor(private readonly deps: AutofillDeps) {}

  /**
   * Rule fills, the default resume and its job, the earlier fill, missing
   * Profile answers and the quota. Free, so it records no run (spec 13).
   */
  async plan(input: PlanInput): Promise<PlanResult> {
    const { page } = input
    const chosen = await this.chooseResume(input)
    const record = chosen?.record ?? null
    const origin = record
      ? await this.deps.jobTargets.findOrigin(record.id)
      : null
    const job = origin ? { company: origin.company, title: origin.title } : null
    const { profile } = await this.deps.profiles.get()
    const rules = ruleFills(input.fields, {
      vendor: page.vendor,
      profile,
      resume: record?.data ?? null,
      linkedin: input.linkedin !== null,
      today: this.deps.clock(),
    })
    const earlier = await this.deps.applications.find(
      page.vendor,
      page.postingKey
    )
    return {
      resumeId: record?.id ?? null,
      resumeChoice: chosen?.choice ?? null,
      job,
      jobMatch: jobMatch(job, page),
      fills: rules.fills,
      overwrites: rules.overwrites,
      classes: rules.classes,
      earlier: earlier
        ? { at: earlier.updatedAt, resumeTitle: earlier.resumeTitle }
        : null,
      missing: missingAnswers(profile, record?.data.basics ?? null),
      quota: await this.deps.runs.quotaStatus("autofill"),
    }
  }

  /**
   * Snapshots the resume the session fills with and records the application
   * (spec 14.4). The snapshot dedupes against the current version, so
   * starting again with an unchanged resume makes no new version.
   */
  async start(input: StartInput): Promise<StartResult> {
    const { page } = input
    const named = [page.company, page.title].filter(Boolean).join(" · ")
    const { version, resume } = await this.deps.versions.snapshotHead(
      input.resumeId,
      { label: `Autofill: ${named || "application"}`, createdBy: "system" }
    )
    // The job target is kept only when its description reaches AI.
    const origin = input.useJob
      ? await this.deps.jobTargets.findOrigin(resume.id)
      : null
    const { id } = await this.deps.applications.upsert({
      vendor: page.vendor,
      postingKey: page.postingKey,
      orgSlug: page.postingKey.split(":")[1] || null,
      url: page.url,
      company: page.company,
      title: page.title,
      resumeId: resume.id,
      resumeVersionId: version.id,
      jobTargetId: origin?.id ?? null,
    })
    return {
      applicationId: id,
      versionId: version.id,
      fileName: resumeFileName(resume.data.basics.name),
      document: {
        data: resume.data,
        templateId: resume.templateId,
        templateOptions: resume.templateOptions,
      },
    }
  }

  /**
   * AI answers for the fields rules left (spec 12), with one run row per
   * request (spec 13). A model that is not configured degrades to plain
   * questions without a run. A failed or late judge or short text call keeps
   * what finished and turns the rest into plain questions (spec 2, 12.4).
   */
  async infer(input: InferInput): Promise<InferResult> {
    const started = Date.now()
    await this.deps.runs.assertWithinHourlyLimit("autofill")
    const keyed = keyFields(aiFields(input.page.vendor, input.fields))
    const page = keyed
      .filter(({ lane }) => lane === "page")
      .map(({ field }) => field.id)
    const asked = keyed
      .filter(({ lane }) => lane !== "page")
      .map(({ field }) => field.id)
    if (asked.length === 0) {
      const result = { fills: [], write: [], page, questions: [] }
      return this.respond(input, { ...result, degraded: false })
    }
    const { models } = this.deps
    const ready = models.ready()
    if (!ready.judge || !ready.text) {
      return this.respond(input, {
        fills: [],
        write: [],
        page,
        questions: plainQuestions(fieldsOf(keyed), asked),
        degraded: true,
      })
    }

    const context = await this.contextInput(input)
    const run = await this.deps.runs.startAutofill({
      resumeId: input.resumeId,
      procedure: "autofill.infer",
      model: models.model,
    })
    const usage = { ...NO_USAGE }
    const finish = (
      status: "completed" | "failed",
      errorClass: string | null
    ) =>
      this.deps.runs.finish(run.id, {
        status,
        errorClass,
        ...usage,
        latencyMs: Date.now() - started,
      })
    let inferred: Inferred
    try {
      inferred = await this.answerFields(input, keyed, context, {
        started,
        usage,
      })
    } catch (error) {
      await finish("failed", "internal")
      throw error
    }
    const { failure } = inferred
    await finish(failure ? "failed" : "completed", failure)
    return this.respond(input, inferred.result)
  }

  /**
   * The judge and short text in parallel until `JUDGE_MS`, the tiers, then
   * the question list until `INFER_MS`. Both deadlines count from the start
   * of the request. `meter.usage` sums the tokens of every call that answered.
   */
  private async answerFields(
    input: InferInput,
    keyed: KeyedField[],
    context: ContextInput,
    meter: { started: number; usage: ModelUsage }
  ): Promise<Inferred> {
    const { models } = this.deps
    const count = <T extends { usage: ModelUsage }>(output: T): T => {
      meter.usage.inputTokens += output.usage.inputTokens
      meter.usage.outputTokens += output.usage.outputTokens
      return output
    }
    const asks = modelInputs(keyed)
    const { judge } = asks
    const step = deadlineAt(meter.started + JUDGE_MS)
    const [judged, short] = await Promise.allSettled([
      judge.choices.length + judge.multi.length + judge.open.length > 0
        ? within(step.call.signal, () =>
            models.judge({
              ...step.call,
              context: applicantContext({ ...context, page: NO_PAGE }),
              ...judge,
            })
          ).then(count)
        : NOTHING_JUDGED,
      asks.short.length > 0
        ? within(step.call.signal, () =>
            models.shortText({
              ...step.call,
              context: applicantContext(context),
              fields: asks.short,
            })
          ).then(count)
        : NOTHING_ANSWERED,
    ])
    step.clear()

    const failed = judged.status === "rejected" || short.status === "rejected"
    const failure = failed ? stepFailure(step.call.signal) : null
    const { fills, write, page, ask } = settle(
      keyed,
      judged.status === "fulfilled" ? judged.value : null,
      short.status === "fulfilled" ? short.value : null
    )
    const degraded = failure !== null
    const result = { fills, write, page, questions: [], degraded }
    if (ask.length === 0) return { result, failure }
    if (failure) {
      const questions = plainQuestions(fieldsOf(keyed), ask)
      return { result: { ...result, questions }, failure }
    }

    // A failed or late question list degrades to plain questions and keeps
    // the fills; the run still completed.
    const listed = deadlineAt(meter.started + INFER_MS)
    const output = await within(listed.call.signal, () =>
      models.questions({
        ...listed.call,
        context: applicantContext(context),
        company: input.page.company,
        fields: questionFields(keyed, ask),
      })
    )
      .then(count)
      .catch(() => null)
    listed.clear()
    const questions = output
      ? questionList(keyed, ask, output.questions)
      : plainQuestions(fieldsOf(keyed), ask)
    return { result: { ...result, questions, degraded: !output }, failure }
  }

  /**
   * What AI may know about the applicant (spec 12.3): the Profile, the
   * resume, the Notes and, only when `useJob`, the origin job.
   */
  private async contextInput(input: AiRequest): Promise<ContextInput> {
    const [{ profile }, record, notes, origin] = await Promise.all([
      this.deps.profiles.get(),
      this.deps.resumes.findById(input.resumeId),
      this.deps.notes.get(),
      input.useJob ? this.deps.jobTargets.findOrigin(input.resumeId) : null,
    ])
    if (!record) throw new AppError("NOT_FOUND", "Resume not found")
    return {
      profile,
      resume: record.data,
      notes: notes.content,
      job: origin && {
        company: origin.company,
        title: origin.title,
        requirements: origin.requirements,
        description: origin.rawText,
      },
      page: { company: input.page.company, title: input.page.title },
      today: this.deps.clock(),
    }
  }

  /** Records the request's counts on the application (spec 14.4) and adds the quota. */
  private async respond(
    input: AiRequest,
    result: Omit<InferResult, "quota">
  ): Promise<InferResult> {
    await this.deps.applications.updateCounts(input.applicationId, input.counts)
    return { ...result, quota: await this.deps.runs.quotaStatus("autofill") }
  }

  /**
   * The user's pick while it exists, else the first default rule (spec 6.2)
   * whose resume still exists.
   */
  private async chooseResume(input: PlanInput): Promise<Chosen | null> {
    if (input.resumeId) {
      const record = await this.deps.resumes.findById(input.resumeId)
      if (record) return { record, choice: "user" }
    }
    const rules: [ResumeChoice, () => Promise<string | null>][] = [
      ["linkedin", () => this.linkedinResume(input.linkedin)],
      ["company", () => this.companyResume(input.page)],
      ["last", () => this.deps.applications.latestResumeId()],
      ["recent", () => this.recentResume()],
    ]
    for (const [choice, find] of rules) {
      const id = await find()
      const record = id ? await this.deps.resumes.findById(id) : null
      if (record) return { record, choice }
    }
    return null
  }

  private async linkedinResume(
    identity: JobIdentity | null
  ): Promise<string | null> {
    if (!identity) return null
    const found = await this.deps.operations.lookup(identity)
    return found.kind === "bound" ? found.resumeId : null
  }

  /** The newest resume tailored for the page's company; never a weak guess. */
  private async companyResume(page: AutofillPage): Promise<string | null> {
    const company = page.companyWeak ? null : page.company
    if (!company) return null
    const origins = await this.deps.jobTargets.listOrigins(ORIGINS_SCANNED)
    return (
      origins.find((row) => companiesMatch(row.company, company))?.resumeId ??
      null
    )
  }

  private async recentResume(): Promise<string | null> {
    return (await this.deps.resumes.page({})).items[0]?.id ?? null
  }
}

const fieldsOf = (keyed: KeyedField[]) => keyed.map(({ field }) => field)

/**
 * A signal that aborts at `deadline` (epoch ms). A timer rather than
 * `AbortSignal.timeout`, which test clocks cannot move.
 */
function deadlineAt(deadline: number): { call: ModelCall; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deadline - Date.now())
  return {
    call: { signal: controller.signal, deadline },
    clear: () => clearTimeout(timer),
  }
}

/**
 * Settles as `call` does, or rejects once the signal aborts, so a model that
 * ignores its signal cannot hold the request. The call's outcome is
 * forwarded: resolving with its promise instead would tie the result to a
 * call that may never settle, and the abort would be ignored.
 */
function within<T>(signal: AbortSignal, call: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    })
    call().then(resolve, reject)
  })
}

/** A step that ran into its deadline timed out; one that failed sooner broke. */
const stepFailure = (signal: AbortSignal): StepFailure =>
  signal.aborted ? "timeout" : "model"

/** A weak or unknown page company cannot contradict the job (spec 6.3). */
function jobMatch(job: JobBrief | null, page: AutofillPage): JobMatch {
  if (!job) return "none"
  if (!page.company || page.companyWeak) return "unknown"
  return companiesMatch(job.company, page.company) ? "match" : "mismatch"
}
