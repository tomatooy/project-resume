import {
  applicantContext,
  type ContextInput,
  companiesMatch,
  type Fill,
  missingAnswers,
  plainQuestions,
  ruleFills,
} from "@workspace/autofill"
import { resumeFileName } from "@workspace/resume-schema"

import type {
  AiRequest,
  AnswerInput,
  AnswerResult,
  AutofillPage,
  GenerateInput,
  GenerateResult,
  InferInput,
  InferResult,
  JobMatch,
  NotesMergeInput,
  NotesMergeResult,
  NotesOutcome,
  NotesUndoInput,
  NotesUndoResult,
  PlanInput,
  PlanResult,
  ResumeChoice,
  StartInput,
  StartResult,
} from "../domain/autofill"
import { AppError } from "../domain/errors"
import type { JobIdentity } from "../domain/job-identity"
import type { JobBrief, ResumeRecord } from "../domain/resume"
import type { AutofillProcedure, Quota } from "../domain/suggestion"
import type { AutofillApplicationRepository } from "../ports/autofill-application-repository"
import type {
  AutofillModels,
  FillFromAnswerOutput,
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
  ANSWER_FILL_MS,
  ANSWER_MERGE_MS,
  aiFields,
  answerFills,
  answerInputs,
  answerTargets,
  draftable,
  draftLimit,
  GENERATE_MS,
  INFER_MS,
  JUDGE_MS,
  type KeyedField,
  keyFields,
  modelInputs,
  type ReadableQuestion,
  questionFields,
  questionList,
  readableQuestions,
  settle,
  shapeDraft,
} from "./autofill-tiers"
import type { RunService } from "./run-service"
import type { VersionService } from "./version-service"

/** How many recent origin links the company rule looks through. */
const ORIGINS_SCANNED = 50

const NO_USAGE: ModelUsage = { inputTokens: 0, outputTokens: 0 }
/** What a call that had nothing to ask returns, without being made. */
const NOTHING_JUDGED: JudgeOutput = {
  choices: {},
  multi: {},
  open: {},
  usage: NO_USAGE,
}
const NOTHING_ANSWERED: ShortTextOutput = { answers: [], usage: NO_USAGE }

/** Why a step failed, as the run row records it. */
type StepFailure = "timeout" | "model"
type ErrorClass = StepFailure | "merge"

/** A step's result, and why it failed when it did. */
type Metered<T> = { value: T; failure: ErrorClass | null }

/** Adds a call's tokens to the run's usage and passes its output on. */
type Count = <T extends { usage: ModelUsage }>(output: T) => T

/** Which models are configured, read once per request. */
type Ready = ReturnType<AutofillModels["ready"]>

type AnswerFills = { fills: Fill[]; unmatched: string[] }

/** What a Notes merge reads besides the Notes. */
type MergeRequest = {
  page: AutofillPage
  readable: ReadableQuestion[]
  text: string
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
    // Keep the selected application link; its description never reaches AI.
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
   * request (spec 13). With neither model configured it degrades to plain
   * questions without a run; with one, the fields the other would answer are
   * asked. A failed or late judge or short text call keeps what finished and
   * turns the rest into plain questions (spec 4).
   */
  async infer(input: InferInput): Promise<InferResult> {
    const started = Date.now()
    await this.deps.runs.assertWithinHourlyLimit("autofill")
    const { vendor } = input.page
    const keyed = keyFields(vendor, aiFields(vendor, input.fields))
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
    if (!ready.judge && !ready.text) {
      return this.respond(input, {
        fills: [],
        write: [],
        page,
        questions: plainQuestions(fieldsOf(keyed), asked),
        degraded: true,
      })
    }

    const context = await this.contextInput(input)
    const result = await this.metered(
      input.resumeId,
      "autofill.infer",
      started,
      (count) => this.answerFields(keyed, context, { ready, started, count })
    )
    return this.respond(input, result)
  }

  /**
   * The judge and short text in parallel until `JUDGE_MS`, the tiers, then
   * the question list until `INFER_MS`. Both deadlines count from `started`,
   * the start of the request. A call whose model is not configured is not
   * made, and its fields are asked as after a failed call, without failing
   * the run.
   */
  private async answerFields(
    keyed: KeyedField[],
    context: ContextInput,
    meter: { ready: Ready; started: number; count: Count }
  ): Promise<Metered<Omit<InferResult, "quota">>> {
    const { models } = this.deps
    const { ready, started, count } = meter
    const asks = modelInputs(keyed)
    const { judge } = asks
    const step = deadlineAt(started + JUDGE_MS)
    const judging = async (): Promise<JudgeOutput | null> => {
      if (judge.choices.length + judge.multi.length + judge.open.length === 0)
        return NOTHING_JUDGED
      if (!ready.judge) return null
      return within(step.call.signal, () =>
        models.judge({
          ...step.call,
          context: applicantContext(context),
          ...judge,
        })
      ).then(count)
    }
    const answering = async (): Promise<ShortTextOutput | null> => {
      if (asks.short.length === 0) return NOTHING_ANSWERED
      if (!ready.text) return null
      return within(step.call.signal, () =>
        models.shortText({
          ...step.call,
          context: applicantContext(context),
          fields: asks.short,
        })
      ).then(count)
    }
    const [judged, short] = await Promise.allSettled([judging(), answering()])
    step.clear()

    const failed = judged.status === "rejected" || short.status === "rejected"
    let failure = failed ? stepFailure(step.call.signal) : null
    const judgedOutput = judged.status === "fulfilled" ? judged.value : null
    const shortOutput = short.status === "fulfilled" ? short.value : null
    const { fills, write, page, ask } = settle(keyed, judgedOutput, shortOutput)
    // Null is a call that failed, or one a missing model could not make.
    const degraded =
      judgedOutput === null ||
      shortOutput === null ||
      Boolean(judgedOutput?.degraded || shortOutput?.degraded)
    if (
      degraded &&
      !failure &&
      (judgedOutput?.degraded || shortOutput?.degraded)
    )
      failure = stepFailure(step.call.signal)
    const value = { fills, write, page, questions: [], degraded }
    if (ask.length === 0) return { value, failure }
    if (failure || !ready.text) {
      const questions = plainQuestions(fieldsOf(keyed), ask)
      return { value: { ...value, questions, degraded: true }, failure }
    }

    // A failed or late question list degrades to plain questions and keeps
    // the fills; the run still completed.
    const listed = deadlineAt(started + INFER_MS)
    const output = await within(listed.call.signal, () =>
      models.questions({
        ...listed.call,
        context: {},
        company: null,
        fields: questionFields(keyed, ask),
      })
    )
      .then(count)
      .catch(() => null)
    listed.clear()
    const questions = output
      ? questionList(keyed, ask, output.questions)
      : plainQuestions(fieldsOf(keyed), ask)
    return {
      value: { ...value, questions, degraded: degraded || !output },
      failure,
    }
  }

  /**
   * **Save and fill again** (spec 4, 8.2): one run that fills the fields the
   * questions name from the user's text and merges the text into Notes, in
   * parallel. The fill has `ANSWER_FILL_MS` and the merge `ANSWER_MERGE_MS`,
   * both from the start of the request. A failed merge keeps the fills.
   */
  async answer(input: AnswerInput): Promise<AnswerResult> {
    const started = Date.now()
    await this.assertCanWrite()
    const context = await this.contextInput(input)
    const { page, text } = input
    const readable = readableQuestions(
      page.vendor,
      input.fields,
      input.questions
    )
    const targets = answerTargets(page.vendor, input.fields, readable)
    const result = await this.metered(
      input.resumeId,
      "autofill.answer",
      started,
      async (count) => {
        const [filled, notes] = await Promise.all([
          this.fillFromAnswer(text, context, readable, targets, {
            started,
            count,
          }),
          this.mergeNotes(
            { page, readable, text },
            started + ANSWER_MERGE_MS,
            count
          ),
        ])
        return {
          value: { ...filled.value, notes: notes.value },
          failure: filled.failure ?? notes.failure,
        }
      }
    )
    return this.respond(input, result)
  }

  /** **Retry** for a merge that failed (spec 8.2), as its own run. */
  async notesMerge(input: NotesMergeInput): Promise<NotesMergeResult> {
    const started = Date.now()
    await this.assertCanWrite()
    // The run row points at the resume, so it must still exist.
    if (!(await this.deps.resumes.findById(input.resumeId))) {
      throw new AppError("NOT_FOUND", "Resume not found")
    }
    const { page, text } = input
    const readable = readableQuestions(page.vendor, [], input.questions)
    const notes = await this.metered(
      input.resumeId,
      "autofill.notes.merge",
      started,
      (count) =>
        this.mergeNotes(
          { page, readable, text },
          started + ANSWER_MERGE_MS,
          count
        )
    )
    return { notes, quota: await this.deps.runs.quotaStatus("autofill") }
  }

  /** Restores the snapshot a merge took (spec 8.3). Free, so no run. */
  notesUndo(input: NotesUndoInput): Promise<NotesUndoResult> {
    return this.deps.notes.undo(input)
  }

  /**
   * A draft for one text field (spec 7), cut to its limit, until
   * `GENERATE_MS`. A failed, late or empty draft closes the run as failed and
   * reaches the caller as an error.
   */
  async generate(input: GenerateInput): Promise<GenerateResult> {
    const started = Date.now()
    const { field } = input
    if (!draftable(input.page.vendor, field)) {
      throw new AppError("VALIDATION", "Write with AI can't draft this field")
    }
    await this.assertCanWrite()
    const context = await this.contextInput(input)
    const text = await this.metered(
      input.resumeId,
      "autofill.generate",
      started,
      async (count): Promise<Metered<string | null>> => {
        const step = deadlineAt(started + GENERATE_MS)
        const output = await within(step.call.signal, () =>
          this.deps.models.generate({
            ...step.call,
            context: applicantContext(context),
            field: {
              label: field.label,
              help: field.help,
              singleLine: field.control !== "textarea",
            },
            limit: draftLimit(field),
            ...(input.instruction ? { instruction: input.instruction } : {}),
          })
        )
          .then(count)
          .catch(() => null)
        step.clear()
        const draft = output ? shapeDraft(output.text, field) : ""
        return draft
          ? { value: draft, failure: null }
          : { value: null, failure: stepFailure(step.call.signal) }
      }
    )
    if (!text) {
      throw new AppError("INTERNAL", "AI couldn't write a draft. Try again.")
    }
    return this.respond(input, { text })
  }

  /**
   * Fills from the user's text until `ANSWER_FILL_MS`: the judge decides the
   * closed fields from the reply by option, and the fill model writes the
   * search and text values, in parallel. A failed call fills none of its
   * fields, and without a configured judge the closed fields stay open.
   */
  private async fillFromAnswer(
    text: string,
    context: ContextInput,
    readable: ReadableQuestion[],
    targets: KeyedField[],
    meter: { started: number; count: Count }
  ): Promise<Metered<AnswerFills>> {
    const { models } = this.deps
    const asks = answerInputs(readable, targets)
    const step = deadlineAt(meter.started + ANSWER_FILL_MS)
    const judging = async (): Promise<JudgeOutput | null> => {
      const { choices, multi } = asks.judge
      if (choices.length + multi.length === 0 || !models.ready().judge)
        return null
      return within(step.call.signal, () =>
        models.judge({
          ...step.call,
          context: applicantContext(context),
          reply: { text },
          ...asks.judge,
        })
      ).then(meter.count)
    }
    const writing = async (): Promise<FillFromAnswerOutput | null> => {
      if (asks.fill.fields.length === 0) return null
      return within(step.call.signal, () =>
        models.fillFromAnswer({
          ...step.call,
          context: applicantContext(context),
          text,
          ...asks.fill,
        })
      ).then(meter.count)
    }
    const [judged, written] = await Promise.allSettled([judging(), writing()])
    step.clear()
    const failed = judged.status === "rejected" || written.status === "rejected"
    const value = answerFills(
      readable,
      targets,
      judged.status === "fulfilled" ? judged.value : null,
      written.status === "fulfilled" ? written.value : null
    )
    return { value, failure: failed ? stepFailure(step.call.signal) : null }
  }

  /**
   * Merges the user's text into Notes (spec 8.2) until `deadline`, which the
   * rerun after a conflict shares. Every attempt's tokens count, and a throw
   * is a failed merge.
   */
  private async mergeNotes(
    { page, readable, text }: MergeRequest,
    deadline: number,
    count: Count
  ): Promise<Metered<NotesOutcome>> {
    const questions = readable.map(({ number, question }) => ({
      number,
      text: question.text,
      options: question.options ?? [],
    }))
    const step = deadlineAt(deadline)
    const notes = await this.deps.notes
      .merge((numbered) =>
        within(step.call.signal, () =>
          this.deps.models.mergeNotes({
            ...step.call,
            numbered,
            questions,
            text,
            company: page.company,
          })
        )
          .then(count)
          .then(({ proposal }) => proposal)
      )
      .catch((): NotesOutcome => ({ kind: "failed" }))
    step.clear()
    if (notes.kind !== "failed") return { value: notes, failure: null }
    const failure = step.call.signal.aborted ? "timeout" : "merge"
    return { value: notes, failure }
  }

  /** Before a paid text call: the hourly limit, then a configured model. */
  private async assertCanWrite(): Promise<void> {
    await this.deps.runs.assertWithinHourlyLimit("autofill")
    if (!this.deps.models.ready().text) {
      throw new AppError("INTERNAL", "AI is not configured")
    }
  }

  /**
   * Runs `work` as one run row (spec 13): sums the tokens it counts and
   * closes the row completed, or failed with the error class it reports. A
   * throw closes the row failed as internal and passes on.
   */
  private async metered<T>(
    resumeId: string,
    procedure: AutofillProcedure,
    started: number,
    work: (count: Count) => Promise<Metered<T>>
  ): Promise<T> {
    const run = await this.deps.runs.startAutofill({
      resumeId,
      procedure,
      model: this.deps.models.model,
    })
    const usage = { ...NO_USAGE }
    const count: Count = (output) => {
      usage.inputTokens += output.usage.inputTokens
      usage.outputTokens += output.usage.outputTokens
      return output
    }
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
    let outcome: Metered<T>
    try {
      outcome = await work(count)
    } catch (error) {
      await finish("failed", "internal")
      throw error
    }
    await finish(outcome.failure ? "failed" : "completed", outcome.failure)
    return outcome.value
  }

  /**
   * What AI may know about the applicant (spec 12.3): the Profile, the
   * resume and complete Notes. Imported job context is never fetched for AI.
   */
  private async contextInput(input: AiRequest): Promise<ContextInput> {
    const [{ profile }, record, notes] = await Promise.all([
      this.deps.profiles.get(),
      this.deps.resumes.findById(input.resumeId),
      this.deps.notes.get(),
    ])
    if (!record) throw new AppError("NOT_FOUND", "Resume not found")
    return {
      profile,
      resume: record.data,
      notes: notes.content,
      today: this.deps.clock(),
    }
  }

  /** Records the request's counts on the application (spec 14.4) and adds the quota. */
  private async respond<T extends object>(
    input: AiRequest,
    result: T
  ): Promise<T & { quota: Quota }> {
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
  // A retry after the shared deadline must not reach the model at all.
  if (signal.aborted) return Promise.reject(signal.reason)
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
