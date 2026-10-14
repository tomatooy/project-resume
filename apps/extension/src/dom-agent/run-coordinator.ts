import {
  type Action,
  type AnswerProposal,
  type CandidateQuestion,
  type InterpretationCache,
  type ObservationCoverage,
  type QuestionDisposition,
  type QuestionPlan,
  type Receipt,
  type ReviewItem,
  type RunCheckpoint,
  type RunState,
  type SourceBundle,
  allReceipts,
  attemptPolicy,
  attachmentTargets,
  ceilingStatus,
  dispositionFor,
  exhaustionReport,
  intentForAction,
  interpretPage,
  newCheckpoint,
  observationCoverage,
  openIntents,
  pageRecordGroups,
  planAnswers,
  planBatches,
  recoveryFor,
  reviewQueue,
  revertedReceipts,
  settleIntent,
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
import { candidateQuestions } from "./questions"
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
 */

/** Where a checkpoint lives. The extension supplies session storage. */
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
  dispositions: Record<string, QuestionDisposition>
  keys: Map<string, string>
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
  private stopRequested: "pause" | "cancel" | null = null
  private readonly clock: () => number

  constructor(private readonly deps: PageRunDeps) {
    this.clock = deps.clock ?? (() => Date.now())
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
    const loaded = await this.deps.store.load(this.deps.stateKey)
    if (loaded) this.checkpoint = withResume(loaded, this.clock())
    else this.checkpoint = { ...this.checkpoint, state: "observing" }
    this.receipts = allReceipts(this.checkpoint)
    await this.save()
    return this.drive("continue")
  }

  /** The user stopped it. Values already written stay where they are. */
  async cancel(reason = "The user stopped the run"): Promise<RunReport> {
    this.stopRequested = "cancel"
    this.checkpoint = withStop(this.checkpoint, {
      state: "cancelled",
      stopped: { kind: "user", reason },
      at: this.clock(),
    })
    await this.save()
    return this.report()
  }

  /** The user paused it, or the run found work that needs them. */
  async pause(reason: string): Promise<RunReport> {
    this.stopRequested = "pause"
    this.checkpoint = withStop(this.checkpoint, {
      state: "paused",
      stopped: { kind: "user", reason },
      at: this.clock(),
    })
    this.waiting = { reason }
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
      this.checkpoint = withResume(loaded, this.clock())
      this.receipts = allReceipts(this.checkpoint)
    }
    this.checkpoint = withStop(this.checkpoint, {
      state: "paused",
      stopped: { kind: "interruption", reason: input.reason },
      at: this.clock(),
    })
    await this.save()
    // The pause is recorded before anything else happens, so a worker that dies
    // again during recovery is still found paused with its receipts intact.
    this.checkpoint = {
      ...this.checkpoint,
      state: "observing",
      stopped: null,
    }
    return this.drive("continue")
  }

  private async drive(mode: "start" | "continue"): Promise<RunReport> {
    this.checkpoint = { ...this.checkpoint, state: "running" }
    try {
      await this.driveRounds(mode)
    } catch (error) {
      // A debugging session can be taken away mid-run: the tab navigated, the
      // worker lost its attachment, or another client attached. None of those
      // is a failed action, and none of them may be reported as one: the run
      // stops, says the connection went, and keeps what it already wrote. The
      // caller reattaches and calls `continueRun`, which observes again.
      if (!isSessionLost(error)) throw error
      this.checkpoint = withStop(this.checkpoint, {
        state: "paused",
        stopped: {
          kind: "connection",
          reason: "The debugging connection was lost",
        },
        at: this.clock(),
      })
      this.waiting = { reason: "The debugging connection was lost" }
      await this.save()
    }
    return this.report()
  }

  private async driveRounds(mode: "start" | "continue"): Promise<void> {
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
      const ceiling = ceilingStatus({
        checkpoint: this.checkpoint,
        now: this.clock(),
      })
      if (ceiling.exhausted) {
        this.exhausted = exhaustionReport({
          reason: ceiling.reason,
          remaining: this.openRefs(),
        })
        this.checkpoint = withStop(this.checkpoint, {
          state: "incomplete",
          stopped: { kind: "ceiling", reason: ceiling.reason },
          at: this.clock(),
        })
        await this.save()
        break
      }
      this.review = reviewQueue({
        questions: stage.questions,
        plans: stage.plans,
        receipts: this.receipts,
        notDispatchable: this.notDispatchable,
      })

      const candidates = await this.candidates(stage)
      // A page with nothing left to write is done for this pass, whether
      // because every question is answered or because the rest is the user's.
      if (candidates.length === 0) break
      const batches = planBatches({
        actions: candidates.map((candidate) => ({
          actionRef: candidate.actionRef,
          questionRef: candidate.questionRef,
          effect: candidate.effect,
          affects: [],
        })),
      })
      mode = "continue"
      let observedAgain = false
      for (const plan of batches) {
        if (this.stopRequested) break
        const batch = plan.actions
          .map((planned) =>
            candidates.find(
              (candidate) => candidate.actionRef === planned.actionRef
            )
          )
          .filter(
            (candidate): candidate is Candidate => candidate !== undefined
          )
        const stopped = await this.runBatch(batch, stage)
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
    if (this.checkpoint.state === "running") {
      this.checkpoint = {
        ...this.checkpoint,
        state: this.review.some((item) => item.blocking)
          ? "needs_input"
          : "auditing",
      }
      await this.save()
    }
  }

  private notDispatchable: string[] = []

  private async observe(): Promise<Stage> {
    // Questions this pass could not express are collected per observation, not
    // accumulated across a run.
    this.notDispatchable = []
    const read = await observePage({ session: this.deps.session })
    const enumeration = candidateQuestions({
      observation: read.observation,
      evidence: read.evidence,
      regions: read.regions,
      records: read.records,
    })
    const questions = await attachPortalOptions({
      session: this.deps.session,
      read,
      enumeration,
    })
    const interpretations = interpretPage({
      questions,
      facts: this.deps.bundle.facts,
      cache: this.deps.cache,
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
      questions,
      loadBundle: this.deps.loadBundle,
    })
    const coverage = observationCoverage(
      [...read.observation.coverage.gaps, ...enumeration.gaps],
      read.observation.coverage.complete
    )
    const dispositions: Record<string, QuestionDisposition> = {}
    const receiptByRef = new Map(
      this.receipts.map((receipt) => [receipt.questionRef, receipt])
    )
    for (const plan of planned.plans)
      dispositions[plan.questionRef] = dispositionFor(
        plan,
        receiptByRef.get(plan.questionRef)
      )
    return {
      read,
      questions,
      plans: planned.plans,
      proposals: planned.proposals,
      coverage,
      dispositions,
      keys,
    }
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
    for (const question of stage.questions) {
      if (settled.has(question.ref)) continue
      const proposal = stage.proposals[question.ref]
      if (!proposal) continue
      const previous = this.checkpoint.attempts[question.ref]
      const correction = correctionFor(proposal)
      const decision = attemptPolicy({
        attempts: previous?.count ?? 0,
        previous: previous
          ? {
              observationKey: previous.observationKey,
              correction: previous.correction,
            }
          : null,
        now: {
          observationKey: this.observationKey(stage, question.ref),
          correction,
        },
      })
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
    // The attachment path is a control like any other: it gets one attempt and
    // at most two corrections, so a site that cannot take the bytes does not
    // get the same upload again on every pass.
    const previous = this.checkpoint.attempts[question.ref]
    const decision = attemptPolicy({
      attempts: previous?.count ?? 0,
      previous: previous
        ? {
            observationKey: previous.observationKey,
            correction: previous.correction,
          }
        : null,
      now: {
        observationKey: this.observationKey(stage, question.ref),
        correction: "attach_file",
      },
    })
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
  private async runBatch(batch: Candidate[], stage: Stage): Promise<boolean> {
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

    this.receipts = [...this.receipts, ...receipts]
    this.checkpoint = withBatch(this.checkpoint, {
      index: this.checkpoint.batches.length,
      actionRefs: batch.map((candidate) => candidate.actionRef),
      dispatchedAt: at,
      settledAt: null,
      receipts,
      reobserve:
        batch.find((candidate) => candidate.effect !== null)?.effect ?? null,
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
      // The page's state and what it said about the failure together: either
      // one changing is new evidence, and neither changing means the same
      // attempt against the same page.
      observationKey: [
        this.observationKey(stage, candidate.questionRef),
        receipt.state,
        receipt.evidence.join(","),
      ].join("|"),
      correction:
        candidate.action?.type ??
        (candidate.proposal ? correctionFor(candidate.proposal) : "unknown"),
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
      const verdict = recoveryFor({
        intent,
        evidence: {
          sameApplication: true,
          // The observation cannot see the site's own attachment state, so an
          // upload is reported as unresolved rather than guessed at either way.
          covered: intent.kind === "record_creation",
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
        verdict.kind === "confirmed" ? "confirmed" : "uncertain",
        this.clock()
      )
    }
    await this.save()
  }

  private async save(): Promise<void> {
    await this.deps.store.save(this.checkpoint)
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
      dispositions: this.stage?.dispositions ?? {},
      checkpoint: this.checkpoint,
      waiting: this.waiting,
      exhausted: this.exhausted,
      recovered: this.recovered,
    }
  }
}

function correctionFor(proposal: AnswerProposal): string {
  return `${proposal.value.type}:${proposal.transformation}`
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
