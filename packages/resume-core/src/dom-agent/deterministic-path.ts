import { z } from "zod"
import type { Action, Precondition } from "./action"
import type { AnswerProposal } from "./answer"
import {
  NATIVE_CONTROL_KINDS,
  type ObservedOption,
  QuestionRefSchema,
  RequirednessSchema,
} from "./primitives"
import {
  canonicalNumberText,
  isoDateText,
  ReasoningRejectionCodeSchema,
  reconcileReasoning,
  type ReasonerAnswer,
} from "./proposal-rules"
import {
  type CandidateQuestion,
  type QuestionDisposition,
  QuestionDispositionSchema,
  normalizeQuestionText,
  reusableQuestionKey,
} from "./question"
import type { Receipt } from "./receipt"
import type { Fact } from "./source"

/**
 * The deterministic answer path: the work that needs no model.
 *
 * A common question whose wording a fact already matches is answered here, and
 * every answer goes through `reconcileReasoning`, the same gate the model's
 * output goes through. There is no second, weaker gate for the deterministic
 * tier, and no value reaches a page because this module was sure of itself.
 *
 * Two things stay deliberately outside: a question whose control kind this
 * engine inferred rather than read natively, and a fact whose value the gate
 * cannot copy or losslessly convert. Both remain unresolved and visible.
 */

/** What the deterministic tier read from one question. */
export const QuestionInterpretationSchema = z.strictObject({
  /** The fact whose meaning the question's wording matches, or null. */
  factId: z.string().min(1).max(80).nullable(),
  /** The observed option a choice-shaped fact selects, or null. */
  optionRef: z.string().min(1).max(64).nullable(),
  basis: z.enum(["exact_wording", "none"]),
})

export type QuestionInterpretation = z.infer<
  typeof QuestionInterpretationSchema
>

const NO_INTERPRETATION: QuestionInterpretation = {
  factId: null,
  optionRef: null,
  basis: "none",
}

/**
 * The evidence a question is identified by: its authored wording, kind,
 * explicit scope and observed options. Null when the page authored no wording,
 * because two unlabelled fields of one kind would share a key and one
 * interpretation would then be handed to the wrong question.
 */
export function interpretationKey(question: CandidateQuestion): string | null {
  return reusableQuestionKey(question)
}

/**
 * Interpretations by semantic evidence rather than by position or reference.
 * A re-observation that renumbers its nodes finds the same interpretation; a
 * question whose wording or options changed does not, and is read again.
 */
export class InterpretationCache {
  private readonly byKey = new Map<string, QuestionInterpretation>()

  get(key: string): QuestionInterpretation | undefined {
    return this.byKey.get(key)
  }

  set(key: string, interpretation: QuestionInterpretation): void {
    this.byKey.set(key, interpretation)
  }

  get size(): number {
    return this.byKey.size
  }
}

export type InterpretedPage = {
  /** One interpretation per question in this observation. */
  byRef: Record<string, QuestionInterpretation>
  /** The key each question was read under. Null means it has no reusable one. */
  keys: Record<string, string | null>
  /** Refs served from the cache without reading the question again. */
  reused: string[]
  /** Refs the interpreter had to read. */
  interpreted: string[]
}

/**
 * The fact whose meaning matches the question's wording exactly.
 *
 * Confined to a native control kind, exactly as the reader's own tier is: on a
 * widget whose kind came from reading a role, an exact wording match would rest
 * on an inference this engine made about the markup, and a wrong inference
 * fills the wrong field. Everything else is the model's to interpret, under
 * the gate.
 */
export function exactFactMatch(
  question: CandidateQuestion,
  facts: readonly Fact[]
): Fact | null {
  const controlKind = question.controlKind
  if (!controlKind || !NATIVE_CONTROL_KINDS.has(controlKind)) return null
  const wording = normalizeQuestionText(question.text)
  if (!wording) return null
  return (
    facts.find((fact) => normalizeQuestionText(fact.meaning) === wording) ??
    null
  )
}

/**
 * The option a boolean or choice fact selects, by what the page itself states.
 *
 * A boolean whose state is neither yes nor no selects nothing: `unknown` and
 * `decline` are answers a person gave, and neither is a yes or a no. A choice
 * fact is matched by its display text, which is the reading a person would take
 * from the option; an id from the bundle names nothing on the page.
 */
export function optionForFact(
  question: CandidateQuestion,
  fact: Fact
): ObservedOption | null {
  const offered = question.options.filter((option) => !option.disabled)
  const factValue = fact.value
  if (factValue.type === "boolean") {
    if (factValue.state !== "yes" && factValue.state !== "no") return null
    const wanted = factValue.state === "yes" ? YES : NO
    return offered.find((option) => isOneOf(option.label, wanted)) ?? null
  }
  if (factValue.type === "choice") {
    const wanted = normalizeQuestionText(fact.display)
    if (!wanted) return null
    return (
      offered.find(
        (option) => normalizeQuestionText(option.label) === wanted
      ) ?? null
    )
  }
  return null
}

const YES: ReadonlySet<string> = new Set(["yes", "y", "true"])
const NO: ReadonlySet<string> = new Set(["no", "n", "false"])

function isOneOf(label: string, wanted: ReadonlySet<string>): boolean {
  return wanted.has(normalizeQuestionText(label))
}

/** Read one question, or hand back what it was read as before. */
export function interpretQuestion(input: {
  question: CandidateQuestion
  facts: readonly Fact[]
  cache?: InterpretationCache
}): {
  interpretation: QuestionInterpretation
  key: string | null
  reused: boolean
} {
  const key = interpretationKey(input.question)
  if (key !== null && input.cache) {
    const found = input.cache.get(key)
    if (found) return { interpretation: found, key, reused: true }
  }
  const interpretation = readQuestion(input.question, input.facts)
  if (key !== null && input.cache) input.cache.set(key, interpretation)
  return { interpretation, key, reused: false }
}

function readQuestion(
  question: CandidateQuestion,
  facts: readonly Fact[]
): QuestionInterpretation {
  const fact = exactFactMatch(question, facts)
  if (!fact) return NO_INTERPRETATION
  return {
    factId: fact.id,
    optionRef: optionForFact(question, fact)?.ref ?? null,
    basis: "exact_wording",
  }
}

/** Read every question once, reusing what the cache already holds. */
export function interpretPage(input: {
  questions: readonly CandidateQuestion[]
  facts: readonly Fact[]
  cache?: InterpretationCache
}): InterpretedPage {
  const byRef: Record<string, QuestionInterpretation> = {}
  const keys: Record<string, string | null> = {}
  const reused: string[] = []
  const interpreted: string[] = []
  for (const question of input.questions) {
    const read = interpretQuestion({
      question,
      facts: input.facts,
      cache: input.cache,
    })
    byRef[question.ref] = read.interpretation
    keys[question.ref] = read.key
    if (read.reused) reused.push(question.ref)
    else interpreted.push(question.ref)
  }
  return { byRef, keys, reused, interpreted }
}

/**
 * Why a question has no answer yet. The wording a person needs is the question
 * itself, which the review queue carries unchanged.
 */
export const AnswerReasonSchema = z.enum([
  /** The reader settled it before any answer was attempted. */
  "structural",
  /** A value was proposed for it and passed the gate. */
  "matched",
  /** No fact's meaning matches this question's wording. */
  "no_matching_fact",
  /** A fact matches, but the page offers no option that means the same thing. */
  "no_matching_option",
  /** A fact matches, but nothing about its value can be written here. */
  "unsupported_value",
  /** The gate refused the proposal, and says why. */
  "rejected",
])

export const QuestionPlanSchema = z.strictObject({
  questionRef: QuestionRefSchema,
  questionKey: z.string().max(64).nullable(),
  /** The disposition before anything is written. A receipt decides after. */
  disposition: QuestionDispositionSchema,
  reason: AnswerReasonSchema,
  rejection: ReasoningRejectionCodeSchema.nullable(),
})

export type QuestionPlan = z.infer<typeof QuestionPlanSchema>

export type PlannedAnswers = {
  plans: QuestionPlan[]
  /** Proposals that passed the gate, by question ref. */
  proposals: Record<string, AnswerProposal>
}

/**
 * Plan the page: one plan per candidate question, always.
 *
 * The proposals go through `reconcileReasoning` exactly as the model's would,
 * so a value that cannot be copied or losslessly converted is refused here
 * rather than written and discovered later.
 */
export function planAnswers(input: {
  questions: readonly CandidateQuestion[]
  facts: readonly Fact[]
  /** What the reader settled before any answer was attempted. */
  seeds: Record<string, QuestionDisposition | undefined>
  interpretations: Record<string, QuestionInterpretation>
}): PlannedAnswers {
  const plans: QuestionPlan[] = []
  const candidates: ReasonerAnswer[] = []
  const structural = new Set<string>()

  for (const question of input.questions) {
    const seed = input.seeds[question.ref]
    if (seed === "unsupported" || seed === "preserved") {
      structural.add(question.ref)
      plans.push({
        questionRef: question.ref,
        questionKey: interpretationKey(question),
        disposition: seed,
        reason: "structural",
        rejection: null,
      })
    }
  }

  for (const question of input.questions) {
    if (structural.has(question.ref)) continue
    const interpretation = input.interpretations[question.ref]
    const fact = input.facts.find(
      (candidate) => candidate.id === interpretation?.factId
    )
    if (!interpretation || !fact) continue
    const candidate = answerFor(question, fact, interpretation)
    if (candidate) candidates.push(candidate)
  }

  const reconciled = reconcileReasoning(
    { answers: candidates, requests: [] },
    { questions: [...input.questions], facts: [...input.facts] }
  )
  const refused = new Map(
    reconciled.rejections
      .filter((rejection) => rejection.questionRef !== null)
      .map((rejection) => [rejection.questionRef, rejection.code])
  )
  const proposals: Record<string, AnswerProposal> = {}
  for (const proposal of reconciled.proposals)
    proposals[proposal.questionRef] = proposal

  for (const question of input.questions) {
    if (structural.has(question.ref)) continue
    const interpretation = input.interpretations[question.ref]
    const key = interpretationKey(question)
    const proposal = proposals[question.ref]
    if (proposal) {
      plans.push({
        questionRef: question.ref,
        questionKey: key,
        disposition: "unverified",
        reason: "matched",
        rejection: null,
      })
      continue
    }
    const rejection = refused.get(question.ref) ?? null
    const matched = interpretation?.factId != null
    const reason = rejection
      ? "rejected"
      : !matched
        ? "no_matching_fact"
        : interpretation?.optionRef === null && needsOption(question)
          ? "no_matching_option"
          : "unsupported_value"
    plans.push({
      questionRef: question.ref,
      questionKey: key,
      disposition: unanswered(question),
      reason,
      rejection,
    })
  }

  return { plans, proposals }
}

/** A choice-shaped question can only be answered through an observed option. */
function needsOption(question: CandidateQuestion): boolean {
  return (
    question.kind === "single_choice" ||
    question.kind === "multi_choice" ||
    question.kind === "yes_no"
  )
}

/**
 * Nothing is verified before a receipt says so, so an unanswered question is
 * either asked for or left blank. Requiredness decides which, and unknown
 * requiredness is asked for rather than assumed optional.
 */
function unanswered(
  question: CandidateQuestion
): "needs_input" | "optional_blank" {
  return question.requiredness.state === "optional"
    ? "optional_blank"
    : "needs_input"
}

/**
 * The shape of an answer a fact can ground here, or null when its value cannot
 * be written into this question at all. The gate decides whether it survives;
 * this only refuses the shapes the gate would refuse for a reason that is
 * knowable before the call.
 */
function answerFor(
  question: CandidateQuestion,
  fact: Fact,
  interpretation: QuestionInterpretation
): ReasonerAnswer | null {
  const value = fact.value
  const base = {
    questionRef: question.ref,
    factIds: [fact.id],
    note: null,
  }
  if (value.type === "text")
    return {
      ...base,
      value: { type: "text", text: value.text },
      transformation: "copy",
    }
  if (value.type === "date") {
    if (question.kind === "date" || question.kind === "month")
      return {
        ...base,
        value: {
          type: "date",
          year: value.year,
          month: value.month,
          day: value.day,
        },
        transformation: "copy",
      }
    return {
      ...base,
      value: { type: "text", text: isoDateText(value) },
      transformation: "format",
    }
  }
  if (value.type === "number") {
    if (question.kind === "number")
      return {
        ...base,
        value: { type: "number", number: value.number },
        transformation: "copy",
      }
    const text = canonicalNumberText(value.number)
    if (text === null) return null
    return {
      ...base,
      value: { type: "text", text },
      transformation: "format",
    }
  }
  if (value.type === "boolean" || value.type === "choice") {
    const optionRef = interpretation.optionRef
    if (optionRef === null) return null
    return {
      ...base,
      value: { type: "choice", optionRefs: [optionRef] },
      transformation: "option_equivalent",
    }
  }
  // Money keeps its amount, currency and period apart, and nothing here writes
  // three fields into one control.
  return null
}

/**
 * One action for one accepted proposal, or null when this observation cannot
 * express it. `expectedValue` and `expectedOptionRef` carry what the control
 * holds now: the page refuses the write when it moved since the observation,
 * which is what makes a stale action a refusal rather than an overwrite.
 */
export function actionFor(input: {
  actionRef: string
  question: CandidateQuestion
  proposal: AnswerProposal
  /** The value the observation read for this control, if any. */
  currentValue: string | null
  precondition: Precondition
}): Action | null {
  const action = {
    ref: input.actionRef,
    questionRef: input.question.ref,
  }
  const value = input.proposal.value
  if (value.type === "text")
    return {
      ...action,
      type: "write_text",
      value: value.text,
      expectedValue: input.currentValue ?? "",
    }
  if (value.type === "number") {
    const text = canonicalNumberText(value.number)
    if (text === null) return null
    return {
      ...action,
      type: "write_text",
      value: text,
      expectedValue: input.currentValue ?? "",
    }
  }
  if (value.type === "date")
    return {
      ...action,
      type: "write_text",
      value: isoDateText(value),
      expectedValue: input.currentValue ?? "",
    }
  const optionRef =
    value.type === "boolean"
      ? value.optionRef
      : value.type === "choice"
        ? (value.optionRefs[0] ?? null)
        : null
  if (optionRef === null) return null
  const selected = input.question.options.find((option) => option.selected)
  return {
    ...action,
    type: "select_option",
    optionRef,
    expectedOptionRef: selected?.ref ?? null,
  }
}

/**
 * Why a question is in the review queue. The queue carries the question's own
 * wording, its options and its requiredness, so a person answers the question
 * the page asked rather than an internal name for it.
 */
export const ReviewReasonSchema = z.enum([
  "no_matching_fact",
  "no_matching_option",
  "unsupported_value",
  "rejected_value",
  "unsupported_control",
  "not_dispatchable",
  "write_failed",
  "write_unverified",
])

export const ReviewItemSchema = z.strictObject({
  questionRef: QuestionRefSchema,
  /** The reusable identity a saved answer could attach to, when there is one. */
  questionKey: z.string().max(64).nullable(),
  /** The page's own wording, unchanged. */
  text: z.string().max(4000),
  kind: z.string().max(40),
  requiredness: RequirednessSchema,
  options: z.array(z.object({ label: z.string().max(500), ref: z.string() })),
  reason: ReviewReasonSchema,
  /** True when this question keeps the page from being ready. */
  blocking: z.boolean(),
  detail: z.string().max(600).nullable(),
})

export type ReviewItem = z.infer<typeof ReviewItemSchema>

/**
 * The questions a person has to look at, with what is known about each. Built
 * from the plans and the receipts, so a write that was dispatched and not
 * confirmed appears here rather than counting as done.
 */
export function reviewQueue(input: {
  questions: readonly CandidateQuestion[]
  plans: readonly QuestionPlan[]
  receipts?: readonly Receipt[]
  /**
   * Questions an answer passed the gate for but no action could be built,
   * because the observation no longer expresses it. Listed rather than
   * dropped: a matched question that never reached the page is exactly the
   * kind that would otherwise go silent.
   */
  notDispatchable?: readonly string[]
}): ReviewItem[] {
  const planByRef = new Map(input.plans.map((plan) => [plan.questionRef, plan]))
  const receiptByRef = new Map<string, Receipt>()
  for (const receipt of input.receipts ?? [])
    receiptByRef.set(receipt.questionRef, receipt)
  const undispatchable = new Set(input.notDispatchable ?? [])

  const items: ReviewItem[] = []
  for (const question of input.questions) {
    const plan = planByRef.get(question.ref)
    if (!plan) continue
    const receipt = receiptByRef.get(question.ref)
    const disposition = dispositionFor(plan, receipt)
    // Deliberately not `questionIsSettled`: that is the readiness rule, where
    // an optional blank is settled and may be left alone. This queue is what a
    // person still has to look at, and an optional question with no answer is
    // visible there without blocking anything.
    if (disposition === "answered" || disposition === "preserved") continue
    const reason = undispatchable.has(question.ref)
      ? "not_dispatchable"
      : reasonFor(plan, receipt)
    if (reason === null) continue
    items.push({
      questionRef: question.ref,
      questionKey: plan.questionKey,
      text: question.text,
      kind: question.kind,
      requiredness: question.requiredness,
      options: question.options.map((option) => ({
        label: option.label,
        ref: option.ref,
      })),
      reason,
      blocking: question.requiredness.state !== "optional",
      detail: detailFor(plan, receipt),
    })
  }
  return items
}

/** The disposition a receipt decides, falling back to what was planned. */
export function dispositionFor(
  plan: QuestionPlan,
  receipt: Receipt | undefined
): z.infer<typeof QuestionDispositionSchema> {
  if (!receipt) return plan.disposition
  if (receipt.state === "accepted") return "answered"
  return "unverified"
}

function reasonFor(
  plan: QuestionPlan,
  receipt: Receipt | undefined
): z.infer<typeof ReviewReasonSchema> | null {
  if (receipt) {
    if (receipt.state === "accepted") return null
    return receipt.state === "unresolved" ? "write_unverified" : "write_failed"
  }
  switch (plan.reason) {
    case "matched":
    case "structural":
      return null
    case "no_matching_fact":
      return "no_matching_fact"
    case "no_matching_option":
      return "no_matching_option"
    case "unsupported_value":
      return "unsupported_value"
    case "rejected":
      return plan.rejection === "kind_mismatch" ||
        plan.rejection === "constraint"
        ? "rejected_value"
        : "no_matching_option"
  }
}

function detailFor(
  plan: QuestionPlan,
  receipt: Receipt | undefined
): string | null {
  if (receipt) return receipt.evidence.join(", ") || null
  return plan.rejection
}
