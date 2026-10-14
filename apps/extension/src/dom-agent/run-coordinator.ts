import {
  type Action,
  type AddedGroup,
  type AnswerProposal,
  type CandidateQuestion,
  InterpretationCache,
  type ObservationCoverage,
  type PageAudit,
  type PageError,
  type PageRecordGroup,
  type QuestionDisposition,
  type QuestionPlan,
  type ReadinessVerdict,
  type Receipt,
  type RecordGroupPlan,
  type ReviewItem,
  type RunCheckpoint,
  type RunState,
  type SourceBundle,
  type SourceRecord,
  type AttemptDecision,
  allReceipts,
  assertTransition,
  attemptPolicy,
  attachmentTargets,
  buildPageAudit,
  ceilingStatus,
  dispositionFor,
  exhaustionReport,
  intentForAction,
  interpretPage,
  isTerminal,
  newCheckpoint,
  observationCoverage,
  openIntents,
  pageRecordGroups,
  planAnswers,
  planBatches,
  readiness,
  recordGroupPlan,
  recordedUpload,
  recoveryFor,
  reviewQueue,
  revertedReceipts,
  settleIntent,
  sourceRecords,
  verifiedProgress,
  withAttempt,
  withBatch,
  withIntents,
  withResume,
  withStop,
} from "@workspace/resume-core/dom-agent"
import { observePage, type PageRead } from "./observation"
import { RUNTIME_EVIDENCE } from "./runtime/protocol"
import {
  attachPortalOptions,
  dispatchAction,
  installRuntime,
  writeOne,
} from "./page-steps"
import { candidateQuestions, type AddGroupControl } from "./questions"
import { payloadBytes } from "./metrics"
import type { BundleLoader } from "./runtime-inject"
import type { RenderedAttachment } from "./runtime-request"
import type { DriverSession } from "./session"
import {
  DriverClosedError,
  StaleContextError,
  StaleResultError,
} from "./session"

/**
 * The run: what is dispatched, in what order, and what survives an
 * interruption.
 *
 * Three things decide the shape of this module. A run is not a plan that
 * survives, so every pass starts from a fresh observation and only the
 * questions still open are planned again. A response that never arrived is not
 * evidence that nothing happened, so an action whose effect cannot be read from
 * one control is written down before it leaves. And the difference between
 * working and waiting for a person is part of the state, not a detail of the
 * loop: the ceiling excludes the time the user was the blocker, and a page the
 * user edits pauses the run rather than being written over.
 * One thing the run does not decide for itself is whether the page is ready.
 * That is the audit's verdict, computed from what was covered and what the page
 * confirmed rather than from the number of writes, and reported beside the run's
 * own state rather than folded into it.
 */
export type RunStore = {
  load(stateKey: string): Promise<RunCheckpoint | null>
  save(checkpoint: RunCheckpoint): Promise<void>
  clear(stateKey: string): Promise<void>
}

/** Bytes for the pinned bundle, or null when none can be had. */
export type AttachmentSource = {
  render(): Promise<RenderedAttachment | null>
}

export type RecoveryNote = {
  actionRef: string
  verdict: "confirmed" | "retry" | "uncertain"
  detail: string
}

export type RunReport = {
  state: RunState
  progress: {
    accepted: number
    unresolved: number
    failed: number
    dispatched: number
  }
  review: ReviewItem[]
  receipts: Receipt[]
  coverage: ObservationCoverage
  questions: CandidateQuestion[]
  dispositions: Record<string, QuestionDisposition>
  checkpoint: RunCheckpoint
  /** Set when the run stopped for a person or a lost connection. */
  waiting: { reason: string } | null
  /** Set when a ceiling stopped it. Never a claim that the page is ready. */
  exhausted: { reason: string; remaining: string[]; offerContinue: true } | null
  /** What a fresh observation said about an action whose answer was lost. */
  recovered: RecoveryNote[]
  /**
   * What the observation's repeated groups are, and what the resume can serve
   * them. A group is added only through a control the reader paired with the
   * container it grows, so a record with nowhere to go is acted on when the page
   * offers that control and reported when it does not.
   */
  recordGroups: RecordGroupPlan
  /**
   * The questions the last round had to read again rather than reuse, in the
   * order it read them.
   *
   * This is the run's own account of how narrow its replan was. After an effect
   * on a control the page declared, it holds that control's questions plus any
   * control the page added; after an effect on a control the page said nothing
   * about, it holds the whole page, which is the honest report of a narrowing
   * the run could not make.
   */
  replanned: string[]
  /**
   * The whole-page audit this pass produced, or null when no pass has read a
   * page. Facts about the page, not a claim about it: every question is placed
   * in one outcome, and what could not be checked is stated in `unchecked`.
   */
  audit: PageAudit | null
  /**
   * The audit's own decision, or null when this pass did not reach one. A run
   * that stopped for the ceiling, for a person, or for a lost connection holds
   * none: what stopped it is reported instead, and readiness is a verdict only
   * a finished pass can give.
   */
  verdict: ReadinessVerdict | null
  /**
   * Size of the observation this run read, as it would be sent. Reported rather
   * than recomputed by a caller, because the caller cannot see the observation
   * the run actually used. Null before anything has been read.
   */
  observationBytes: number | null
}

export type PageRunDeps = {
  session: DriverSession
  bundle: SourceBundle
  store: RunStore
  /** Account, tab and application together, from `temporaryStateKey`. */
  stateKey: string
  loadBundle: BundleLoader
  attachments?: AttachmentSource
  cache?: InterpretationCache
  clock?: () => number
}

type Stage = {
  read: PageRead
  questions: CandidateQuestion[]
  plans: QuestionPlan[]
  proposals: Record<string, AnswerProposal>
  coverage: ObservationCoverage
  recordGroups: RecordGroupPlan
  /** The controls this page offers for growing a repeated container. */
  addGroupControls: AddGroupControl[]
  keys: Map<string, string>
  /**
   * What this page's controls say they change, in question refs. A question with
   * no entry is one the page said nothing about, which is not the same as one
   * that changes nothing.
   */
  effectScopes: Map<string, string[]>
  /** The questions this round read again rather than reusing what it had. */
  replanned: string[]
}

/** A plan for a page nothing has been read from yet. */
const NO_RECORD_GROUPS: RecordGroupPlan = {
  bindings: [],
  refusals: [],
  supplements: [],
  missing: [],
  next: { kind: "none" },
}

type Candidate = {
  actionRef: string
  questionRef: string
  /** The question and proposal to write, or an action built by the run. */
  question: CandidateQuestion
  proposal: AnswerProposal | null
  action: Action | null
  attachment: RenderedAttachment | null
  effect: "record_group" | "option_discovery" | "upload_parsing" | null
}

export class PageRun {
  private checkpoint: RunCheckpoint
  private stage: Stage | null = null
  private receipts: Receipt[] = []
  private review: ReviewItem[] = []
  private recovered: RecoveryNote[] = []
  private waiting: { reason: string } | null = null
  private exhausted: RunReport["exhausted"] = null
  private audit: PageAudit | null = null
  private verdict: ReadinessVerdict | null = null
  /** When this pass read the page, which is not when it wrote to it. */
  private observedAt: number | null = null
  private stopRequested: "pause" | "cancel" | null = null
  private readonly clock: () => number
  /**
   * What each question was read as, carried across the rounds of one run.
   *
   * Keyed by the question's own evidence rather than by its reference, so a
   * re-observation that renumbers its nodes finds the same reading, and a
   * question whose wording or options changed is read again. That is what lets
   * the round after an effect replan the questions the effect touched instead of
   * reading the meaning of the whole page again.
   */
  private readonly interpretations: InterpretationCache

  constructor(private readonly deps: PageRunDeps) {
    this.clock = deps.clock ?? (() => Date.now())
    this.interpretations = deps.cache ?? new InterpretationCache()
    this.checkpoint = newCheckpoint({
      runId: deps.session.runId,
      stateKey: deps.stateKey,
      sourceBundleId: deps.bundle.id,
      documentGeneration: String(deps.session.generation),
      at: this.clock(),
    })
  }

  get current(): RunCheckpoint {
    return this.checkpoint
  }

  /** One explicit Fill: a fresh run, a fresh checkpoint, no remembered plan. */
  async start(): Promise<RunReport> {
    this.stopRequested = null
    await this.save()
    return this.drive("start")
  }

  /**
   * Continue observes the page and validates what was already written before
   * proposing anything. It never resumes a suspended plan: the checkpoint holds
   * history, and history is not a plan.
   */
  async continueRun(): Promise<RunReport> {
    this.stopRequested = null
    // Cancelling is terminal, so a cancelled run is not continued: the panel
    // starts a new run for a new Fill. Reported rather than thrown, because
    // this is a person's click and not an engine mistake.
    if (isTerminal(this.checkpoint.state)) return this.afterCancellation()
    const loaded = await this.deps.store.load(this.deps.stateKey)
    if (loaded) {
      // Whatever the checkpoint says it was doing, a continue observes again.
      assertMove(loaded.state, "observing")
      this.checkpoint = withResume(loaded, this.clock())
    } else {
      assertMove(this.checkpoint.state, "observing")
      this.checkpoint = { ...this.checkpoint, state: "observing" }
    }
    this.receipts = allReceipts(this.checkpoint)
    await this.save()
    return this.drive("continue")
  }

  /** The user stopped it. Values already written stay where they are. */
  async cancel(reason = "The user stopped the run"): Promise<RunReport> {
    this.stopRequested = "cancel"
    // Cancelling is terminal, so a second one has nothing left to stop. The
    // values already written stay where they are either way.
    if (!isTerminal(this.checkpoint.state))
      this.move("cancelled", { kind: "user", reason })
    // The audit's facts about the page stand, but the verdict was about a pass
    // this run no longer is: a cancelled run is not the audit's to call ready.
    this.verdict = null
    await this.save()
    return this.report()
  }

  /** The user paused it, or the run found work that needs them. */
  async pause(reason: string): Promise<RunReport> {
    this.stopRequested = "pause"
    // A cancelled run is not paused: it is already over, and saying it paused
    // would offer a continue that cannot happen.
    if (!isTerminal(this.checkpoint.state))
      this.move("paused", { kind: "user", reason })
    this.waiting = { reason }
    this.verdict = null
    await this.save()
    return this.report()
  }

  /**
   * A worker restart, a navigation or a lost debugging session. Every one of
   * them ends the current view of the page, so recovery is the same in all
   * three cases: reattach, load the checkpoint, observe again, and write
   * nothing that was already dispatched. The revision moves forward, because a
   * write at a revision the page already wrote is refused as a replay.
   */
  async interrupted(input: {
    kind: "worker_restart" | "navigation" | "detach"
    /** True when the page is no longer the same application. */
    differentApplication: boolean
    reason: string
  }): Promise<RunReport> {
    this.stopRequested = null
    if (isTerminal(this.checkpoint.state)) return this.afterCancellation()
    const loaded = await this.deps.store.load(this.deps.stateKey)
    if (!loaded || input.differentApplication) {
      // A different application inherits nothing: not the bundle, not the
      // answers, and not the receipts that belong to the page that is gone.
      await this.deps.store.clear(this.deps.stateKey)
      this.checkpoint = newCheckpoint({
        runId: this.deps.session.runId,
        stateKey: this.deps.stateKey,
        sourceBundleId: this.deps.bundle.id,
        documentGeneration: String(this.deps.session.generation),
        at: this.clock(),
      })
      this.receipts = []
      this.review = []
    } else {
      assertMove(loaded.state, "observing")
      this.checkpoint = withResume(loaded, this.clock())
      this.receipts = allReceipts(this.checkpoint)
    }
    this.move("paused", { kind: "interruption", reason: input.reason })
    await this.save()
    // The pause is recorded before anything else happens, so a worker that dies
    // again during recovery is still found paused with its receipts intact.
    this.move("observing")
    return this.drive("continue")
  }

  private async drive(mode: "start" | "continue"): Promise<RunReport> {
    this.move("running")
    try {
      await this.driveRounds(mode)
    } catch (error) {
      // A debugging session can be taken away mid-run: the tab navigated, the
      // worker lost its attachment, or another client attached. None of those
      // is a failed action, and none of them may be reported as one: the run
      // stops, says the connection went, and keeps what it already wrote. The
      // caller reattaches and calls `continueRun`, which observes again.
      if (!isSessionLost(error)) throw error
      this.move("paused", {
        kind: "connection",
        reason: "The debugging connection was lost",
      })
      this.waiting = { reason: "The debugging connection was lost" }
      await this.save()
    }
    return this.report()
  }

  /**
   * What a run that was already cancelled says to a continue or an
   * interruption. The values it wrote stay written; the run itself does not
   * come back to life, because a cancelled run is the user's decision and a new
   * Fill is how they reverse it.
   */
  private afterCancellation(): RunReport {
    this.waiting = {
      reason: "This run was cancelled. Start a new run to fill the page again.",
    }
    return this.report()
  }

  /**
   * Move the run's state, refusing a move the table in `run.ts` forbids. The
   * table is the authority on which states a run may be in, so a move the
   * engine cannot make is an error here rather than a checkpoint nobody can
   * act on. Reaching the same state twice is not a move, and a move with no
   * stop behind it clears the last one: a state the run is working in does not
   * carry the record of why it stopped earlier.
   */
  private move(
    state: RunState,
    stopped: {
      kind: NonNullable<RunCheckpoint["stopped"]>["kind"]
      reason: string
    } | null = null
  ): void {
    if (state !== this.checkpoint.state)
      assertTransition(this.checkpoint.state, state)
    this.checkpoint = stopped
      ? withStop(this.checkpoint, { state, stopped, at: this.clock() })
      : { ...this.checkpoint, state, stopped: null }
  }

  private async driveRounds(mode: "start" | "continue"): Promise<void> {
    // A report from an earlier pass is not this pass's: both are cleared here so
    // a pass that ends early reports no verdict rather than a stale one.
    this.audit = null
    this.verdict = null
    // A round is one observation and the batches planned from it, up to the
    // first batch that changes what the next questions are. Bounded by the run
    // ceiling, which every round checks before it dispatches anything.
    for (;;) {
      if (this.stopRequested) break

      const stage = await this.observe()
      if (mode === "continue") {
        await this.afterContinue(stage)
        // An action whose answer never arrived is settled by looking at the
        // page, never by assuming it failed and sending it again.
        await this.settleIntents(stage)
      }
      this.stage = stage
      // Checked after observing, so an exhausted run can name what is still
      // open rather than reporting an empty remainder.
      if (await this.stopForCeiling()) break
      const candidates = await this.candidates(stage)
      // Built from this pass's own decisions as well as from the observation, so
      // a question the run has just decided not to dispatch is in the queue now
      // rather than reaching the user a pass later.
      this.review = reviewQueue({
        questions: stage.questions,
        plans: stage.plans,
        receipts: this.receipts,
        notDispatchable: this.notDispatchable,
      })
      // A page with nothing left to write is done for this pass, whether
      // because every question is answered or because the rest is the user's.
      if (candidates.length === 0) break
      const batches = planBatches({
        actions: candidates.map((candidate) => ({
          actionRef: candidate.actionRef,
          questionRef: candidate.questionRef,
          effect: candidate.effect,
          // The questions the page says this control changes, so a batch that
          // ends at an effect states the set it deferred rather than the empty
          // set it used to. Only an action that also states an effect may claim
          // one: the scheduler refuses a claim with nothing said about what
          // changed, and a control whose effect this engine has not observed is
          // written without a narrowing rather than with an unstated one. A page
          // that said nothing about the effect carries none either, and the round
          // after it reads the page's meaning again.
          affects:
            candidate.effect === null
              ? []
              : (stage.effectScopes.get(candidate.questionRef) ?? []),
        })),
      })
      mode = "continue"
      let observedAgain = false
      for (const plan of batches) {
        if (this.stopRequested) break
        // Checked between the batches of one round as well: a full batch is a
        // scheduling limit, so a round of several of them would otherwise run
        // past the ceiling before the next round looked at it.
        if (await this.stopForCeiling()) break
        const batch = plan.actions
          .map((planned) =>
            candidates.find(
              (candidate) => candidate.actionRef === planned.actionRef
            )
          )
          .filter(
            (candidate): candidate is Candidate => candidate !== undefined
          )
        const stopped = await this.runBatch(batch, stage, plan.affected)
        if (stopped) break
        // The next batch either runs from this observation, because a full
        // batch is only a scheduling limit, or waits for a fresh one because
        // this batch changed what the page asks.
        if (plan.reobserve !== null) {
          observedAgain = true
          break
        }
      }
      if (this.stopRequested || this.waiting) break
      if (!observedAgain) break
    }
    // What the pass saw, reported whether or not it reached a verdict: the audit
    // is a record of the page, and a pass that stopped for the ceiling or for a
    // person has still read it. The queue is rebuilt here too, where the receipts
    // and the dispositions already are. Without that rebuild a write the page
    // refused reaches the user a pass later, which is the same cold-versus-warm
    // disagreement the dispositions were moved for. Decisions taken before the
    // batch stay in the queue: `notDispatchable` accumulates across the round.
    if (this.stage !== null) {
      this.audit = buildPageAudit({
        id: `audit-${this.stage.read.observation.id}`,
        observation: this.stage.read.observation,
        observedAt: this.observedAt ?? this.clock(),
        questions: this.stage.questions,
        dispositions: this.dispositions(),
        receipts: this.receipts,
        errors: this.pageErrors(this.stage),
      })
      this.review = reviewQueue({
        questions: this.stage.questions,
        plans: this.stage.plans,
        receipts: this.receipts,
        notDispatchable: this.notDispatchable,
      })
    }

    if (this.checkpoint.state === "running") {
      // The verdict is the audit's decision, never the number of writes. It is
      // decided before the move because a blocking question is reachable from
      // `running` and not from `auditing`: the table in run.ts is the authority
      // on which states exist.
      const requests = this.recordRequests(this.stage)
      this.verdict =
        this.audit === null
          ? null
          : readiness({
              audit: this.audit,
              questions: this.stage?.questions ?? [],
            })
      // The audit judges the questions the page asked. An entry the page wants
      // and the resume cannot serve is not one of them, so the run withholds the
      // verdict itself rather than calling a page ready while it holds a request
      // it cannot answer. Readiness stays a decision about evidence, and this is
      // evidence the audit was never given.
      if (requests.length > 0 && this.verdict?.state === "ready")
        this.verdict = { state: "incomplete", reasons: requests }
      if (this.verdict?.state === "ready") {
        // `ready` is not reachable straight from `running`, so the pass records
        // that it audited before it claims the verdict.
        this.move("auditing")
        this.move("ready")
      } else {
        if (requests.length > 0 && this.waiting === null)
          this.waiting = {
            reason: `The page asks for ${requests.join(", ")}`,
          }
        this.move(
          requests.length > 0 || this.review.some((item) => item.blocking)
            ? "needs_input"
            : "incomplete"
        )
      }
      await this.save()
    }
  }

  /**
   * What the record plan is waiting for a person to settle, if anything.
   *
   * A required entry the resume cannot account for is the applicant's history to
   * supply, and a group whose record the run could not name is theirs to place.
   * Neither is answerable from the sources, and neither may be guessed at, so
   * both reach the run's report as a request rather than as silence.
   */
  private recordRequests(stage: Stage | null): string[] {
    const plan = stage?.recordGroups
    if (!plan) return []
    const requests: string[] = []
    if (plan.missing.length > 0)
      requests.push(`${plan.missing.length} entry the resume does not hold`)
    if (plan.refusals.length > 0)
      requests.push(`${plan.refusals.length} entry this run could not place`)
    return requests
  }

  /**
   * Stop the run when its budget is spent, and report what is still open. The
   * ceiling is about working time, so the report is `incomplete` with an offer
   * to continue: exhaustion is never a claim that the page is ready.
   */
  private async stopForCeiling(): Promise<boolean> {
    if (this.exhausted) return true
    const ceiling = ceilingStatus({
      checkpoint: this.checkpoint,
      now: this.clock(),
    })
    if (!ceiling.exhausted) return false
    this.exhausted = exhaustionReport({
      reason: ceiling.reason,
      remaining: this.openRefs(),
    })
    this.move("incomplete", { kind: "ceiling", reason: ceiling.reason })
    await this.save()
    return true
  }

  /**
   * The attempt decision for one question: the page, the correction and the
   * last refusal are all carried into it, so a retry has something new to go on
   * and the same attempt against the same page does not repeat.
   */
  private attemptFor(
    stage: Stage,
    questionRef: string,
    correction: string
  ): AttemptDecision {
    const previous = this.checkpoint.attempts[questionRef]
    return attemptPolicy({
      attempts: previous?.count ?? 0,
      previous: previous
        ? {
            observationKey: previous.observationKey,
            correction: previous.correction,
            failure: previous.failure ?? null,
          }
        : null,
      now: {
        observationKey: this.observationKey(stage, questionRef),
        correction,
        // What the page said last time, unchanged on purpose: the decision is
        // whether anything is different, and re-stating the last refusal is how
        // "the same refusal again" is expressed.
        failure: previous?.failure ?? null,
      },
    })
  }

  private notDispatchable: string[] = []

  private async observe(): Promise<Stage> {
    // Questions this pass could not express are collected per observation, not
    // accumulated across a run.
    this.notDispatchable = []
    const at = this.clock()
    const read = await observePage({ session: this.deps.session })
    this.observedAt = at
    const enumeration = candidateQuestions({
      observation: read.observation,
      evidence: read.evidence,
      regions: read.regions,
      records: read.records,
      groupAddControls: read.groupAddControls,
      effectScopes: read.effectScopes,
    })
    const questions = await attachPortalOptions({
      session: this.deps.session,
      read,
      enumeration,
    })
    // What the last batch left behind. A page that said nothing about an effect
    // it let happen never licenses a narrowing: the round reads the page's
    // meaning again rather than reusing what an earlier round read, because only
    // a declared reach says which questions the effect could have changed.
    const last = this.checkpoint.batches[this.checkpoint.batches.length - 1]
    const undeclared =
      last !== undefined &&
      last.reobserve !== null &&
      last.affected.length === 0
    const interpretations = interpretPage({
      questions,
      facts: this.deps.bundle.facts,
      cache: undeclared ? undefined : this.interpretations,
    })
    const planned = planAnswers({
      questions,
      facts: this.deps.bundle.facts,
      seeds: enumeration.dispositions,
      interpretations: interpretations.byRef,
    })
    const keys = await installRuntime({
      session: this.deps.session,
      read,
      // The add controls are questions to the runtime, so their documents need
      // it installed as much as the ones a person fills in.
      questions: [
        ...questions,
        ...enumeration.addGroupControls.map((control) => control.question),
      ],
      loadBundle: this.deps.loadBundle,
    })
    const coverage = observationCoverage(
      [...read.observation.coverage.gaps, ...enumeration.gaps],
      read.observation.coverage.complete
    )
    const groups = pageRecordGroups({
      observation: read.observation,
      questions,
    })
    const records = sourceRecords(this.deps.bundle.facts)
    const recordGroups = recordGroupPlan({
      groups,
      records,
      added: this.addedGroups(groups, records, enumeration.addGroupControls),
    })
    return {
      read,
      questions,
      plans: planned.plans,
      proposals: planned.proposals,
      coverage,
      recordGroups,
      addGroupControls: enumeration.addGroupControls,
      effectScopes: enumeration.effectScopes,
      // What the interpreter had to read this round. A question whose evidence
      // the page changed cannot be served from the cache, so after an effect this
      // is the questions the effect touched plus whatever the page added.
      replanned: interpretations.interpreted,
      keys,
    }
  }

  /**
   * The groups this run added and has not yet placed.
   *
   * A record-creation intent is written before the add leaves, so an intent still
   * open on the next read is the run's own account of what it grew, and the group
   * that appeared is the one past the count recorded with it. Two guards keep
   * that from becoming a guess: only a blank group can be the one that appeared,
   * because a group holding values was there before, and the record is only
   * placed when the container it was added to already holds a record of that
   * kind. Otherwise nothing is bound and the group stays the person's to resolve.
   */
  private addedGroups(
    groups: readonly PageRecordGroup[],
    records: readonly SourceRecord[],
    controls: readonly AddGroupControl[]
  ): AddedGroup[] {
    // An intent the page confirmed still counts. The run's own account of what it
    // grew outlives the pass that settled it, and without it a group the run added
    // is only placed while it happens to be the last record left, which fails the
    // moment two entries are added for two records. An open intent counts too,
    // because the add may have landed with no reply. Every other state is the page
    // having answered, and one of those answers is that the add did not land, so
    // the states are listed rather than excluded one by one.
    const recorded = this.checkpoint.intents.filter(
      (intent) =>
        intent.kind === "record_creation" &&
        (intent.settled === null || intent.settled === "confirmed")
    )
    if (recorded.length === 0) return []
    // What the rules would place without this run's own account of an add, which
    // is what says which records are still free and which kind a container holds.
    const before = recordGroupPlan({ groups, records })
    // Only what the page itself placed counts. The rules also place a lone blank
    // group for the last record left, and treating that as evidence would make
    // the record this add was for look taken before the add is accounted for.
    const placed = new Set(
      before.bindings
        .filter((binding) => binding.evidence === "observed_identity_match")
        .map((binding) => binding.recordId)
    )
    const added: AddedGroup[] = []
    for (const intent of recorded) {
      const group =
        intent.groupCount === null ? undefined : groups[intent.groupCount]
      if (!group || group.values.length > 0) continue
      const control = controls.find((entry) =>
        entry.groupRefs.includes(group.groupRef)
      )
      const kind = control ? this.containerKind(control, before, records) : null
      if (kind === null) continue
      const record = records.find(
        (entry) => entry.kind === kind && !placed.has(entry.id)
      )
      if (!record) continue
      placed.add(record.id)
      added.push({ groupRef: group.groupRef, recordId: record.id })
    }
    return added
  }

  /**
   * The kind of record a container holds, from what it already placed. A
   * container holding nothing yet has no kind this reader can state, and a group
   * is never added to one on the strength of its position alone.
   */
  private containerKind(
    control: AddGroupControl,
    plan: RecordGroupPlan,
    records: readonly SourceRecord[]
  ): SourceRecord["kind"] | null {
    for (const binding of plan.bindings) {
      if (!control.groupRefs.includes(binding.groupRef)) continue
      const record = records.find((entry) => entry.id === binding.recordId)
      if (record) return record.kind
    }
    return null
  }

  /**
   * What a fresh observation says about what was written before. A receipt the
   * page no longer reflects is dropped, so its question is planned again rather
   * than counted as done.
   */
  private async afterContinue(stage: Stage): Promise<void> {
    const observed: Record<
      string,
      {
        value?: string | null
        checked?: boolean | null
        optionRef?: string | null
      }
    > = {}
    for (const question of stage.questions) {
      const node = stage.read.observation.nodes.find(
        (candidate) => candidate.ref === question.controlRef
      )
      if (!node) continue
      observed[question.ref] = {
        value: node.control?.value ?? null,
        checked: node.control?.checked ?? null,
        optionRef:
          question.options.find((option) => option.selected)?.ref ?? null,
      }
    }
    const reverted = revertedReceipts(this.receipts, observed)
    if (reverted.length === 0) return
    const dropped = new Set(reverted.map((receipt) => receipt.questionRef))
    this.receipts = this.receipts.filter(
      (receipt) => !dropped.has(receipt.questionRef)
    )
    for (const questionRef of dropped)
      this.checkpoint = withAttempt(this.checkpoint, questionRef, {
        observationKey: this.observationKey(stage, questionRef),
        correction: "revalidate",
      })
    await this.save()
  }

  /** The page's own state for a question, as a value a retry can be judged on. */
  private observationKey(stage: Stage, questionRef: string): string {
    const question = stage.questions.find(
      (candidate) => candidate.ref === questionRef
    )
    const node = stage.read.observation.nodes.find(
      (candidate) => candidate.ref === question?.controlRef
    )
    const control = node?.control
    if (!control) return "absent"
    return [
      control.kind,
      control.disabled ? "disabled" : "enabled",
      control.readonly ? "readonly" : "writable",
      control.value === null || control.value === "" ? "empty" : "valued",
      control.checked === null ? "stateless" : String(control.checked),
    ].join(":")
  }

  /**
   * What this pass would write, and why each entry is allowed to be written.
   * Questions already settled by a receipt are not here, and a control that
   * failed is only retried with new evidence or a different correction.
   */
  private async candidates(stage: Stage): Promise<Candidate[]> {
    const settled = this.settledRefs()
    const candidates: Candidate[] = []
    let counter = this.receipts.length
    // A group is added before anything is written, and its own batch ends there.
    // Growing the page can move every reference under it, so the writes are
    // planned from a fresh observation of the page the add produced rather than
    // from the observation it invalidated.
    const add = this.recordGroupCandidate(stage, counter)
    if (add) {
      candidates.push(add)
      counter += 1
    }
    for (const question of stage.questions) {
      if (settled.has(question.ref)) continue
      const proposal = stage.proposals[question.ref]
      if (!proposal) continue
      const decision = this.attemptFor(
        stage,
        question.ref,
        correctionFor(proposal)
      )
      if (decision.kind === "skip") {
        this.notDispatchable.push(question.ref)
        continue
      }
      counter += 1
      candidates.push({
        actionRef: `a${counter}`,
        questionRef: question.ref,
        question,
        proposal,
        action: null,
        attachment: null,
        effect: stage.read.evidence.get(question.controlRef)?.portal
          ? "option_discovery"
          : null,
      })
    }
    const upload = await this.attachmentCandidate(stage, settled, counter)
    if (upload) candidates.push(upload)
    return candidates
  }

  /**
   * The one group this pass may add, or null.
   *
   * Both halves have to be on the page: a plan naming a record with nowhere to
   * put it, and a control the reader paired with the container that record
   * belongs to. The pair is required rather than inferred, because a control
   * pressed on a page whose container nobody identified is how a blank entry
   * lands in a real application. The run presses once, the intent is written
   * before the dispatch leaves, and the batch re-observes so the group it grew
   * is placed before another is asked for.
   */
  private recordGroupCandidate(
    stage: Stage,
    counter: number
  ): Candidate | null {
    const next = stage.recordGroups.next
    if (next.kind !== "add_group") return null
    const records = sourceRecords(this.deps.bundle.facts)
    const record = records.find((entry) => entry.id === next.recordId)
    if (!record) return null
    const control = this.containerForKind(stage, record.kind)
    if (!control) return null
    const decision = this.attemptFor(stage, control.ref, "add_record_group")
    if (decision.kind === "skip") {
      this.notDispatchable.push(control.ref)
      return null
    }
    const actionRef = `a${counter + 1}`
    return {
      actionRef,
      questionRef: control.ref,
      question: control.question,
      proposal: null,
      action: {
        ref: actionRef,
        questionRef: control.ref,
        type: "add_record_group",
        recordRef: record.id,
      },
      attachment: null,
      effect: "record_group",
    }
  }

  /**
   * The container a record of this kind belongs to, from what that container
   * already placed. A container holding no record of the kind has nothing that
   * says it is the right one, so no control answers for it.
   */
  private containerForKind(
    stage: Stage,
    kind: SourceRecord["kind"]
  ): AddGroupControl | null {
    const records = sourceRecords(this.deps.bundle.facts)
    for (const binding of stage.recordGroups.bindings) {
      const bound = records.find((entry) => entry.id === binding.recordId)
      if (!bound || bound.kind !== kind) continue
      const control = stage.addGroupControls.find((entry) =>
        entry.groupRefs.includes(binding.groupRef)
      )
      if (control) return control
    }
    return null
  }

  /**
   * The resume attachment, when the page has one field for it and the run can
   * obtain the bytes. The action states the identity of those bytes, so the
   * page refuses an attachment rendered for a different document or template.
   */
  private async attachmentCandidate(
    stage: Stage,
    settled: Set<string>,
    counter: number
  ): Promise<Candidate | null> {
    const source = this.deps.attachments
    if (!source) return null
    const target = attachmentTargets(stage.questions).target
    if (!target || settled.has(target.questionRef)) return null
    const question = stage.questions.find(
      (candidate) => candidate.ref === target.questionRef
    )
    if (!question) return null
    // An upload this run already wrote down is never sent a second time. The
    // first response was lost, and a fresh observation cannot read the site's
    // own file list, so sending it again is how one attachment becomes two.
    // The question waits for the user instead, which is where it appears.
    if (recordedUpload(this.checkpoint, question.ref)) {
      this.notDispatchable.push(question.ref)
      return null
    }
    // The attachment path is a control like any other: it gets one attempt and
    // at most two corrections, so a site that cannot take the bytes does not
    // get the same upload again on every pass.
    const decision = this.attemptFor(stage, question.ref, "attach_file")
    if (decision.kind === "skip") {
      this.notDispatchable.push(question.ref)
      return null
    }
    const rendered = await source.render()
    if (!rendered) return null
    return {
      actionRef: `a${counter + 1}`,
      questionRef: question.ref,
      question,
      proposal: null,
      action: {
        ref: `a${counter + 1}`,
        questionRef: question.ref,
        type: "attach_file",
        pdfIdentity: rendered.identity,
        // Nothing in this run has a reviewed choice to replace with, so the
        // honest value is that nothing may be replaced.
        replaceExisting: false,
        replacementConfirmedAt: null,
      },
      attachment: rendered,
      effect: "upload_parsing",
    }
  }

  private settledRefs(): Set<string> {
    const settled = new Set<string>()
    for (const receipt of this.receipts)
      if (receipt.state === "accepted") settled.add(receipt.questionRef)
    // An upload the page's own state confirmed is settled even when the
    // response that would have produced a receipt never arrived: the run wrote
    // the bytes once and the field holds them, so nothing is owed for it.
    for (const intent of this.checkpoint.intents)
      if (intent.kind === "upload" && intent.settled === "confirmed")
        settled.add(intent.questionRef)
    return settled
  }

  private openRefs(): string[] {
    const settled = this.settledRefs()
    const open: string[] = []
    for (const question of this.stage?.questions ?? [])
      if (!settled.has(question.ref)) open.push(question.ref)
    return open
  }

  /**
   * One batch: every intent written down before the action that needs it
   * leaves, then the actions, then the receipts and the checkpoint together.
   */
  private async runBatch(
    batch: Candidate[],
    stage: Stage,
    /** The questions the page said this batch's effect touches. */
    declared: readonly string[] = []
  ): Promise<boolean> {
    const revision = this.checkpoint.questionRevision
    const at = this.clock()
    const groupCount = pageRecordGroups({
      observation: stage.read.observation,
      questions: stage.questions,
    }).length
    const intents = batch
      .map((candidate) =>
        intentFor(candidate, {
          at,
          groupCount,
          attachmentName: null,
        })
      )
      .filter((intent): intent is NonNullable<typeof intent> => intent !== null)
    if (intents.length > 0) {
      // Written before the dispatch, not after: a response that never arrives
      // must not leave a record group or an attachment the run cannot account
      // for.
      this.checkpoint = withIntents(this.checkpoint, intents)
      await this.save()
    }

    const receipts: Receipt[] = []
    let epoch = this.checkpoint.userEditEpoch
    let edited = false
    for (const candidate of batch) {
      if (this.stopRequested) break
      const attempt =
        candidate.action !== null
          ? await dispatchAction({
              session: this.deps.session,
              read: stage.read,
              question: candidate.question,
              action: candidate.action,
              keys: stage.keys,
              bundle: this.deps.bundle,
              revision,
              userEditEpoch: epoch,
              attachment: candidate.attachment,
              at: this.clock(),
            })
          : candidate.proposal
            ? await writeOne({
                session: this.deps.session,
                read: stage.read,
                question: candidate.question,
                proposal: candidate.proposal,
                actionRef: candidate.actionRef,
                keys: stage.keys,
                bundle: this.deps.bundle,
                revision,
                userEditEpoch: epoch,
                attachment: null,
                at: this.clock(),
              })
            : { kind: "not_dispatchable" as const }
      if (attempt.kind !== "receipt") {
        this.notDispatchable.push(candidate.questionRef)
        continue
      }
      if (attempt.userEditEpoch !== null) {
        epoch = attempt.userEditEpoch
        this.checkpoint = { ...this.checkpoint, userEditEpoch: epoch }
      }
      receipts.push(attempt.receipt)
      // A refusal that names the user's own edit stops the batch there. The
      // refusal also reports the epoch the page is at, and treating that as
      // permission for the next action would write into the form the user is
      // working in, which is the one thing this rule exists to prevent.
      if (attempt.receipt.evidence.includes(RUNTIME_EVIDENCE.userEditedPage)) {
        edited = true
        break
      }
      if (attempt.receipt.state !== "accepted")
        this.recordAttempt(stage, candidate, attempt.receipt)
    }

    const reobserve =
      batch.find((candidate) => candidate.effect !== null)?.effect ?? null
    // The questions the page said this batch's effect touches, as the scheduler
    // carried them. A page that said nothing leaves this empty while `reobserve`
    // still records that an effect happened, which is what keeps "touches
    // nothing" apart from "did not say".
    const affected = reobserve === null ? [] : [...new Set(declared)]
    this.receipts = [...this.receipts, ...receipts]
    this.checkpoint = withBatch(this.checkpoint, {
      index: this.checkpoint.batches.length,
      actionRefs: batch.map((candidate) => candidate.actionRef),
      dispatchedAt: at,
      settledAt: null,
      receipts,
      reobserve,
      affected,
    })
    await this.save()

    const editedReceipt = receipts.find((receipt) =>
      receipt.evidence.includes(RUNTIME_EVIDENCE.userEditedPage)
    )
    if (edited || editedReceipt) {
      // The user is working in the form. That is not a failure to retry: the
      // run stops, keeps what it wrote, and waits for them.
      await this.pause(
        "The page was edited by hand while the run was filling it"
      )
      return true
    }
    return this.stopRequested !== null
  }

  private recordAttempt(
    stage: Stage,
    candidate: Candidate,
    receipt: Receipt
  ): void {
    this.checkpoint = withAttempt(this.checkpoint, candidate.questionRef, {
      // The page's own state, bare. The retry decision compares this with the
      // page as it is now, so folding a receipt into it would make every
      // attempt look like new evidence and a failed control would be retried
      // against an unchanged page.
      observationKey: this.observationKey(stage, candidate.questionRef),
      correction:
        candidate.action?.type ??
        (candidate.proposal ? correctionFor(candidate.proposal) : "unknown"),
      // What the page said, kept beside the page's state rather than inside it,
      // so a different refusal is a different attempt and the same one is not.
      failure: [receipt.state, ...receipt.evidence].join(":").slice(0, 200),
    })
  }

  /**
   * What a fresh observation says about an intent whose answer was lost. An
   * unresolved intent stays open and explicit; it is never retried on the
   * assumption that it failed.
   */
  private async settleIntents(stage: Stage): Promise<void> {
    const open = openIntents(this.checkpoint)
    if (open.length === 0) return
    const groups = pageRecordGroups({
      observation: stage.read.observation,
      questions: stage.questions,
    }).length
    for (const intent of open) {
      // A receipt is the page's own answer and settles the intent better than a
      // fresh look can: an upload the field took is not doubtful merely because
      // the site's file list cannot be read from here.
      const receipt = this.receipts.find(
        (candidate) => candidate.questionRef === intent.questionRef
      )
      const question = stage.questions.find(
        (candidate) => candidate.ref === intent.questionRef
      )
      const verdict =
        receipt?.state === "accepted"
          ? {
              kind: "confirmed" as const,
              detail: "The page accepted it when it answered",
            }
          : recoveryFor({
              intent,
              evidence: {
                // The question still being on this page is the evidence that
                // this is still the application the intent was made for. A
                // question that is gone cannot be settled by whatever replaced
                // it, so its intent stays doubtful.
                sameApplication: question !== undefined,
                // A record group is judged on a page that was read in full; a
                // read with a gap in it cannot say the group is absent. An
                // upload owns no such evidence: the observation cannot see the
                // site's own attachment state at all.
                covered:
                  intent.kind === "record_creation" && stage.coverage.complete,
                groupCount: intent.kind === "record_creation" ? groups : null,
                attachmentName: null,
              },
            })
      this.recovered.push({
        actionRef: intent.actionRef,
        verdict: verdict.kind,
        detail: verdict.detail,
      })
      this.checkpoint = settleIntent(
        this.checkpoint,
        intent.actionRef,
        // Only the page saying it landed is a confirmation. A verdict that says
        // it did not is not a reason to act twice either, and it is recorded as
        // what it was rather than as doubt: a page that showed the action had not
        // landed answered the question, and calling that uncertainty makes every
        // later observation repeat the doubt instead of the finding.
        verdict.kind === "confirmed"
          ? "confirmed"
          : verdict.kind === "retry"
            ? "retried"
            : "uncertain",
        this.clock()
      )
    }
    await this.save()
  }

  private async save(): Promise<void> {
    await this.deps.store.save(this.checkpoint)
  }

  /**
   * What the page says is wrong, tied to the questions this run asked.
   *
   * The page states the link itself: a control declares itself invalid and names
   * the element holding the wording, and the reader carries both. A control that
   * is invalid but became no question here is still an error on the page, so it is
   * reported against no question rather than dropped or attached to a guess.
   */
  private pageErrors(stage: Stage | null): PageError[] {
    if (stage === null) return []
    const questionForControl = new Map(
      stage.questions.map((question) => [question.controlRef, question.ref])
    )
    const errors: PageError[] = []
    for (const node of stage.read.observation.nodes) {
      const evidence = stage.read.evidence.get(node.ref)
      if (!evidence?.invalid) continue
      errors.push({
        questionRef: questionForControl.get(node.ref) ?? null,
        message:
          evidence.errorText ??
          "The page marks this control invalid and states no wording for it.",
      })
    }
    return errors
  }

  private report(): RunReport {
    const progress = verifiedProgress(this.receipts)
    return {
      state: this.checkpoint.state,
      progress: { ...progress, dispatched: this.receipts.length },
      review: this.review,
      receipts: this.receipts,
      coverage: this.stage?.coverage ?? { complete: false, gaps: [] },
      questions: this.stage?.questions ?? [],
      dispositions: this.dispositions(),
      checkpoint: this.checkpoint,
      waiting: this.waiting,
      exhausted: this.exhausted,
      recovered: this.recovered,
      recordGroups: this.stage?.recordGroups ?? NO_RECORD_GROUPS,
      replanned: this.stage?.replanned ?? [],
      audit: this.audit,
      verdict: this.verdict,
      observationBytes: this.stage
        ? payloadBytes(this.stage.read.observation)
        : null,
    }
  }

  /**
   * What each question's latest answer says. Decided here, where the receipts
   * are, rather than while observing: the receipts that confirm a write arrive
   * after the observation that planned it, so a cold run would otherwise report
   * every question it just confirmed as unverified.
   */
  private dispositions(): Record<string, QuestionDisposition> {
    const receiptByRef = new Map(
      this.receipts.map((receipt) => [receipt.questionRef, receipt])
    )
    const dispositions: Record<string, QuestionDisposition> = {}
    for (const plan of this.stage?.plans ?? [])
      dispositions[plan.questionRef] = dispositionFor(
        plan,
        receiptByRef.get(plan.questionRef)
      )
    return dispositions
  }
}

function correctionFor(proposal: AnswerProposal): string {
  return `${proposal.value.type}:${proposal.transformation}`
}

/**
 * Refuse a state move the table in `run.ts` forbids. Reaching the state a run is
 * already in is not a move.
 */
function assertMove(from: RunState, to: RunState): void {
  if (from !== to) assertTransition(from, to)
}

/** The three ways a debugging session makes a result worthless. */
function isSessionLost(error: unknown): boolean {
  return (
    error instanceof DriverClosedError ||
    error instanceof StaleContextError ||
    error instanceof StaleResultError
  )
}

/** The intent an action needs written down before it leaves, if any. */
function intentFor(
  candidate: Candidate,
  input: { at: number; groupCount: number; attachmentName: string | null }
) {
  const type = candidate.action?.type
  // Record creation: the intent is on disk before the control is pressed, so a
  // group the page grew is one the run wrote down and can place on the next
  // observation rather than one it finds and has to guess about.
  if (type === "add_record_group")
    return intentForAction({
      kind: "record_creation",
      actionRef: candidate.actionRef,
      questionRef: candidate.questionRef,
      groupCount: input.groupCount,
      attachmentName: null,
      at: input.at,
    })
  if (type === "attach_file")
    return intentForAction({
      kind: "upload",
      actionRef: candidate.actionRef,
      questionRef: candidate.questionRef,
      groupCount: null,
      attachmentName: input.attachmentName,
      at: input.at,
    })
  return null
}
