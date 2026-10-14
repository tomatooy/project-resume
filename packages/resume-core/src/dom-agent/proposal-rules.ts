import { z } from "zod"
import {
  type AnswerProposal,
  ProposedValueSchema,
  TransformationSchema,
} from "./answer"
import { DOM_AGENT_LIMITS } from "./limits"
import { QuestionRefSchema, type QuestionKind } from "./primitives"
import type { CandidateQuestion } from "./question"
import type { Fact, FactValue } from "./source"

type ProposedValue = z.infer<typeof ProposedValueSchema>

/**
 * What the model returns, and the gate that decides what may stand.
 *
 * The model cites facts by id and this module expands them into provenance, so
 * a proposal can only ever point at evidence the bundle actually holds. The
 * model decides a value and names a transformation; every rule that decides
 * whether that transformation is allowed lives here, in one place, and is run
 * again by whoever writes the value.
 */

/**
 * One answer the model believes it can ground. `factIds` rather than source
 * refs: a reference the model typed could name anything, while an id it was
 * given names something the bundle holds.
 */
export const ReasonerAnswerSchema = z.strictObject({
  questionRef: QuestionRefSchema,
  value: ProposedValueSchema,
  transformation: TransformationSchema,
  factIds: z.array(z.string().min(1).max(80)).max(8),
  note: z.string().max(400).nullable(),
})

/** What the model could not ground. A question for the user, never a value. */
export const ReasonerRequestSchema = z.strictObject({
  questionRef: QuestionRefSchema,
  /** What is missing, in the question's own terms. Never page content. */
  missing: z.string().min(1).max(300),
})

export const ReasonerOutputSchema = z.strictObject({
  answers: z
    .array(ReasonerAnswerSchema)
    .max(DOM_AGENT_LIMITS.questionsPerRequest),
  requests: z
    .array(ReasonerRequestSchema)
    .max(DOM_AGENT_LIMITS.questionsPerRequest),
})

export type ReasonerAnswer = z.infer<typeof ReasonerAnswerSchema>
export type InformationRequest = z.infer<typeof ReasonerRequestSchema>
export type ReasonerOutput = z.infer<typeof ReasonerOutputSchema>

/**
 * Why a proposal did not become an answer. One code per refusal, because the
 * panel and the audit both read this: a question the model tried and failed to
 * ground is a different thing from one it never mentioned.
 */
export const ReasoningRejectionCodeSchema = z.enum([
  "unknown_question",
  "duplicate_answer",
  "unbound",
  "not_same_value",
  "not_lossless",
  "not_user_confirmed",
  "option_not_observed",
  "option_count",
  "kind_mismatch",
  "constraint",
  "unparsed",
])

export const ReasoningRejectionSchema = z.strictObject({
  /** Null when the refusal is about the output as a whole. */
  questionRef: QuestionRefSchema.nullable(),
  code: ReasoningRejectionCodeSchema,
})

export type ReasoningRejectionCode = z.infer<
  typeof ReasoningRejectionCodeSchema
>
export type ReasoningRejection = z.infer<typeof ReasoningRejectionSchema>

/** What reasoning is allowed to see. A subset of the request, by design. */
export type ReasoningScope = {
  questions: CandidateQuestion[]
  facts: Fact[]
}

export type ReconciledReasoning = {
  proposals: AnswerProposal[]
  requests: InformationRequest[]
  /** Questions with neither a proposal nor a request. Never silently empty. */
  unresolved: string[]
  rejections: ReasoningRejection[]
}

/** Sources a person authored, as opposed to a document they wrote once. */
const USER_AUTHORED: ReadonlySet<string> = new Set([
  "saved_answer",
  "application_answer",
  "user_input",
])

/**
 * The one place a fact becomes automatic. A question the driver could not type
 * is absent on purpose: a plausible copy into a control nobody understood is
 * the guess this gate exists to refuse.
 */
function kindAccepts(value: ProposedValue, kind: QuestionKind): boolean {
  switch (value.type) {
    case "text":
      return kind === "short_text" || kind === "long_text" || kind === "url"
    case "number":
      return kind === "number"
    case "date":
      return kind === "date" || kind === "month"
    case "boolean":
      return kind === "yes_no"
    case "choice":
      return kind === "single_choice" || kind === "multi_choice"
    case "file":
      return false
  }
}

/** The exact text form of a date. Every part the fact holds survives. */
export function isoDateText(value: {
  year: number
  month: number | null
  day: number | null
}): string {
  const year = String(value.year).padStart(4, "0")
  if (value.month === null) return year
  const month = String(value.month).padStart(2, "0")
  if (value.day === null) return `${year}-${month}`
  return `${year}-${month}-${String(value.day).padStart(2, "0")}`
}

/**
 * The exact decimal text of a number, or null when the only text form is
 * exponential, which is not a form a page asks for.
 */
export function canonicalNumberText(number: number): string | null {
  const text = String(number)
  return /[eE]/.test(text) ? null : text
}

/**
 * The text a fact converts to without losing anything, or null when no such
 * conversion exists. A text fact is absent because converting text to text is
 * a copy, and a money fact because a bare number drops its currency and period.
 */
function losslessText(fact: FactValue): string | null {
  switch (fact.type) {
    case "date":
      return isoDateText(fact)
    case "number":
      return canonicalNumberText(fact.number)
    case "text":
    case "boolean":
    case "money":
    case "choice":
      return null
  }
}

function sameDate(
  fact: { year: number; month: number | null; day: number | null },
  value: { year: number; month: number | null; day: number | null }
): boolean {
  return (
    fact.year === value.year &&
    fact.month === value.month &&
    fact.day === value.day
  )
}

/** A fact whose value could be the same thing as an option the page offers. */
function isOptionFact(fact: Fact): boolean {
  return fact.value.type === "boolean" || fact.value.type === "choice"
}

function isUserAuthored(fact: Fact): boolean {
  return USER_AUTHORED.has(fact.source.kind)
}

/**
 * Whether the fact's value is exactly the value proposed. Only the three
 * shapes that line up one to one: a boolean becomes an option and a saved
 * choice becomes a page option through `option_equivalent`, never a copy.
 */
function sameValue(fact: FactValue, value: ProposedValue): boolean {
  switch (value.type) {
    case "text":
      return fact.type === "text" && fact.text === value.text
    case "number":
      return fact.type === "number" && fact.number === value.number
    case "date":
      return fact.type === "date" && sameDate(fact, value)
    case "boolean":
    case "choice":
    case "file":
      return false
  }
}

/** Whether the option refs fit the question, and the question is that shape. */
function optionShape(
  value: ProposedValue,
  kind: QuestionKind
): ReasoningRejectionCode | null {
  if (value.type === "boolean") {
    return kind === "yes_no" ? null : "kind_mismatch"
  }
  if (value.type !== "choice") return "kind_mismatch"
  const count = value.optionRefs.length
  if (kind === "single_choice") return count === 1 ? null : "option_count"
  if (kind === "multi_choice") return count >= 1 ? null : "option_count"
  return "kind_mismatch"
}

function optionRefs(value: ProposedValue): string[] {
  if (value.type === "boolean") return [value.optionRef]
  if (value.type === "choice") return value.optionRefs
  return []
}

/**
 * The gate over one answer. Returns the code it fails on, or null when every
 * rule holds. Order matters only for which reason is reported.
 */
function checkAnswer(
  question: CandidateQuestion,
  answer: ReasonerAnswer,
  cited: Fact[]
): ReasoningRejectionCode | null {
  const { value, transformation } = answer
  // An attachment is rendered from the pinned bundle, so a proposal naming one
  // is claiming a source it does not have.
  if (value.type === "file") return "kind_mismatch"

  if (value.type === "boolean" || value.type === "choice") {
    if (transformation === "copy" || transformation === "format") {
      return "not_same_value"
    }
    if (transformation === "option_equivalent" && !cited.some(isOptionFact)) {
      return "unbound"
    }
    if (transformation === "user_confirmed" && !cited.some(isUserAuthored)) {
      return "not_user_confirmed"
    }
    const shape = optionShape(value, question.kind)
    if (shape) return shape
    const offered = new Set(
      question.options
        .filter((option) => !option.disabled)
        .map((option) => option.ref)
    )
    return optionRefs(value).every((ref) => offered.has(ref))
      ? null
      : "option_not_observed"
  }

  if (transformation === "option_equivalent") return "kind_mismatch"

  if (transformation === "user_confirmed") {
    if (!cited.some(isUserAuthored)) return "not_user_confirmed"
    if (!cited.some((fact) => sameValue(fact.value, value))) {
      return "not_same_value"
    }
  } else if (transformation === "copy") {
    if (!cited.some((fact) => sameValue(fact.value, value))) {
      return "not_same_value"
    }
  } else {
    const text = value.type === "text" ? value.text : null
    if (
      text === null ||
      !cited.some((fact) => losslessText(fact.value) === text)
    ) {
      return "not_lossless"
    }
    // A pattern the page states is an assertion about the converted text that
    // nothing here can verify, and running an authored pattern over model
    // output is not a check worth trusting. It is not a lossless conversion.
    if (question.constraints?.pattern) return "not_lossless"
  }

  if (!kindAccepts(value, question.kind)) return "kind_mismatch"
  // A month control cannot hold the day, so dropping it would be lossy.
  if (
    question.kind === "month" &&
    value.type === "date" &&
    value.day !== null
  ) {
    return "kind_mismatch"
  }
  const maxLength = question.constraints?.maxLength
  if (
    maxLength !== null &&
    maxLength !== undefined &&
    value.type === "text" &&
    value.text.length > maxLength
  ) {
    return "constraint"
  }
  return null
}

/**
 * The deterministic gate over one model response.
 *
 * Nothing here reads a number out of text, invents prose, or trusts a claim of
 * confidence. A proposal that fails any rule is dropped and reported: the
 * question stays unresolved and visible rather than quietly half-answered.
 */
export function reconcileReasoning(
  raw: unknown,
  scope: ReasoningScope
): ReconciledReasoning {
  const rejections: ReasoningRejection[] = []
  const parsed = ReasonerOutputSchema.safeParse(raw)
  if (!parsed.success) {
    rejections.push({ questionRef: null, code: "unparsed" })
    return {
      proposals: [],
      requests: [],
      unresolved: scope.questions.map((question) => question.ref),
      rejections,
    }
  }

  const questions = new Map(
    scope.questions.map((question) => [question.ref, question])
  )
  const facts = new Map(scope.facts.map((fact) => [fact.id, fact]))
  const answered = new Set<string>()
  const requested = new Set<string>()
  const proposals: AnswerProposal[] = []
  const requests: InformationRequest[] = []

  for (const answer of parsed.data.answers) {
    const question = questions.get(answer.questionRef)
    if (!question) {
      rejections.push({
        questionRef: answer.questionRef,
        code: "unknown_question",
      })
      continue
    }
    if (answered.has(answer.questionRef)) {
      rejections.push({
        questionRef: answer.questionRef,
        code: "duplicate_answer",
      })
      continue
    }
    const cited: Fact[] = []
    let unknownFact = answer.factIds.length === 0
    for (const id of new Set(answer.factIds)) {
      const fact = facts.get(id)
      if (!fact) unknownFact = true
      else cited.push(fact)
    }
    if (unknownFact) {
      rejections.push({ questionRef: answer.questionRef, code: "unbound" })
      continue
    }
    const code = checkAnswer(question, answer, cited)
    if (code) {
      rejections.push({ questionRef: answer.questionRef, code })
      continue
    }
    answered.add(answer.questionRef)
    // Provenance is expanded from the facts, so a proposal cannot cite
    // something the bundle does not hold.
    proposals.push({
      questionRef: answer.questionRef,
      value: answer.value,
      transformation: answer.transformation,
      sources: cited.map((fact) => fact.source),
      note: answer.note,
    })
  }

  for (const request of parsed.data.requests) {
    if (!questions.has(request.questionRef)) {
      rejections.push({
        questionRef: request.questionRef,
        code: "unknown_question",
      })
      continue
    }
    // An answered question needs no request, and a question is asked about
    // once, however many times the model repeats it.
    if (answered.has(request.questionRef)) continue
    if (requested.has(request.questionRef)) continue
    requested.add(request.questionRef)
    requests.push(request)
  }

  return {
    proposals,
    requests,
    unresolved: scope.questions
      .filter(
        (question) =>
          !answered.has(question.ref) && !requested.has(question.ref)
      )
      .map((question) => question.ref),
    rejections,
  }
}
