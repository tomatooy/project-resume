import { z } from "zod"
import { ScopedAnswerSchema, type ScopedAnswer } from "../autofill/contract"
import {
  ProfileSectionSchema,
  ProfileSections,
  type ProfileSection,
} from "../autofill-profile/schema"
import { AppError } from "../domain/errors"
import { ScopeEntrySchema, type ScopeEntry } from "./primitives"
import { FactValueSchema, type Fact, type FactValue } from "./source"

/**
 * A stored answer as it is read back, plus the question identity it may carry.
 *
 * ADR 0001 makes the question key the identity, so a row without one cannot
 * become a source fact: a fact's provenance has to name the question it
 * answers. Every such row is returned for review rather than generalized.
 */
export const StoredAnswerSchema = ScopedAnswerSchema.extend({
  questionKey: z.string().length(16).optional(),
  /** The value in the shape the question needs, when the row carries it. */
  factValue: FactValueSchema.optional(),
})
export type StoredAnswer = z.infer<typeof StoredAnswerSchema>

export const ReviewAnswerSchema = z.strictObject({
  answerId: z.uuid(),
  revision: z.number().int().positive(),
  meaning: z.string().min(1).max(200),
  value: z.string().max(4000),
  scope: z.array(ScopeEntrySchema).max(10),
  /**
   * `no_question_key`: the row predates the question identity, so nothing can
   * tell which question it belongs to and it must not be generalized.
   * `unsupported_value`: the row is keyed, but it holds a display string where
   * the question needs a structured value, and parsing that string would be an
   * inference of ours rather than something the user stated.
   * `excluded_concept`: the concept is excluded from sources by decision, so a
   * keyed row that carries a structured value is no more eligible than an
   * unkeyed one. EEO is the case today.
   */
  reason: z.enum(["no_question_key", "unsupported_value", "excluded_concept"]),
  confirmedAt: z.iso.datetime(),
})
export type ReviewAnswer = z.infer<typeof ReviewAnswerSchema>

/**
 * Concepts whose answer is a structured value. A stored display string is not
 * one, and parsing text into a number or a date is the invented inference the
 * specification forbids, so these stay reviewable until the row carries a
 * value the vocabulary can express.
 */
const STRUCTURED_CONCEPT =
  /^(salary|work_authorized|sponsorship_|relocation|available_from|eeo_|experience_|education_|current_employer$|recent_employer$)/

/** Legacy conditions as explicit scope. Scope is meaning, so this is spelled out. */
export function scopeFromConditions(
  conditions: ScopedAnswer["conditions"]
): ScopeEntry[] {
  const scope: ScopeEntry[] = []
  if (conditions.countryCode)
    scope.push({ dimension: "country", value: conditions.countryCode })
  if (conditions.employerId)
    scope.push({ dimension: "employer", value: conditions.employerId })
  if (conditions.currency)
    scope.push({ dimension: "currency", value: conditions.currency })
  if (conditions.salaryPeriod)
    scope.push({ dimension: "period", value: conditions.salaryPeriod })
  if (conditions.jobId)
    scope.push({ dimension: "other", value: `job:${conditions.jobId}` })
  return scope
}

export type StoredAnswerOutcome =
  | { kind: "fact"; fact: Fact }
  | { kind: "review"; answer: ReviewAnswer }

/**
 * Map one stored row. A row with a question key and a value the vocabulary can
 * express becomes a fact; anything else stays visible for the user to resolve.
 */
export function factFromStoredAnswer(raw: StoredAnswer): StoredAnswerOutcome {
  const answer = StoredAnswerSchema.parse(raw)
  const scope = scopeFromConditions(answer.conditions)
  const concept = answer.meaning.concept
  if (!answer.questionKey)
    return {
      kind: "review",
      answer: reviewAnswer(answer, scope, "no_question_key"),
    }
  // EEO is excluded from the bundle outright (see the spec's decision table). A
  // keyed row with a structured value would otherwise sail past the check below,
  // which only catches the display-string case.
  if (concept.startsWith("eeo_"))
    return {
      kind: "review",
      answer: reviewAnswer(answer, scope, "excluded_concept"),
    }
  if (!answer.factValue && STRUCTURED_CONCEPT.test(concept))
    return {
      kind: "review",
      answer: reviewAnswer(answer, scope, "unsupported_value"),
    }
  return {
    kind: "fact",
    fact: {
      id: `saved:${answer.id}`,
      meaning: meaningPhrase(concept, scope),
      display: answer.value,
      value: answer.factValue ?? { type: "text", text: answer.value },
      scope,
      source: {
        kind: "saved_answer",
        answerId: answer.id,
        questionKey: answer.questionKey,
      },
    },
  }
}

function reviewAnswer(
  answer: StoredAnswer,
  scope: ScopeEntry[],
  reason: ReviewAnswer["reason"]
): ReviewAnswer {
  return {
    answerId: answer.id,
    revision: answer.revision,
    meaning: meaningPhrase(answer.meaning.concept, scope),
    value: answer.value,
    scope,
    reason,
    confirmedAt: answer.confirmedAt,
  }
}

/** A readable phrase for matching. The key is the identity; this is the label. */
function meaningPhrase(concept: string, scope: ScopeEntry[]): string {
  const country = scope.find((entry) => entry.dimension === "country")?.value
  const base = concept.replaceAll("_", " ")
  return (country ? `${base} (${country})` : base).slice(0, 200)
}

/**
 * Where a confirmed answer is kept. The default is this application only, and
 * every other destination is a choice the user has to make explicitly.
 */
export const ProfileTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("field"),
    section: ProfileSectionSchema,
    field: z.string().min(1).max(80),
  }),
  /**
   * Salary is the one target that is not a single field: an amount without its
   * currency and period is a different answer, so the three move together.
   */
  z.strictObject({ kind: z.literal("salary") }),
])
export type ProfileTarget = z.infer<typeof ProfileTargetSchema>

export const AnswerDestinationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("application") }),
  z.strictObject({
    kind: z.literal("reusable"),
    scope: z.array(ScopeEntrySchema).min(1).max(10),
    questionKey: z.string().length(16),
  }),
  z.strictObject({
    kind: z.literal("profile"),
    target: ProfileTargetSchema,
    questionKey: z.string().length(16),
  }),
])
export type AnswerDestination = z.infer<typeof AnswerDestinationSchema>

export type DestinationChoice = {
  /** Omitted means the default: this application, nothing persisted. */
  keep?: "reusable" | "profile"
  scope?: ScopeEntry[]
  target?: ProfileTarget
  questionKey?: string
}

export function answerDestination(
  choice: DestinationChoice = {}
): AnswerDestination {
  if (!choice.keep) return { kind: "application" }
  if (!choice.questionKey)
    throw new AppError(
      "VALIDATION",
      "Keep an answer only once its question has an identity"
    )
  if (choice.keep === "reusable") {
    // Unknown scope is not a wildcard: it prevents saving for reuse.
    if (!choice.scope?.length)
      throw new AppError(
        "VALIDATION",
        "Choose the scope this answer may be reused in"
      )
    return {
      kind: "reusable",
      scope: choice.scope,
      questionKey: choice.questionKey,
    }
  }
  if (!choice.target)
    throw new AppError("VALIDATION", "Choose the Profile field to save into")
  return {
    kind: "profile",
    target: choice.target,
    questionKey: choice.questionKey,
  }
}

/** Sections whose shape is a set of named fields rather than a list. */
const FIELD_SECTIONS = ["identity", "links", "address", "preferences"] as const

export function isFieldSection(
  section: ProfileSection
): section is (typeof FIELD_SECTIONS)[number] {
  return (FIELD_SECTIONS as readonly string[]).includes(section)
}

/** A Profile field the schema actually declares, which is what "matching" means. */
export function profileFieldNames(section: ProfileSection): readonly string[] {
  if (!isFieldSection(section)) return []
  return Object.keys(ProfileSections[section].shape)
}

export function profileFieldExists(
  section: ProfileSection,
  field: string
): boolean {
  return profileFieldNames(section).includes(field)
}

/** The value a Profile field expects, or a refusal. Never a coerced string. */
export function profileFieldValue(
  value: FactValue,
  target: { section: ProfileSection; field: string }
): Record<string, string | number> {
  if (!profileFieldExists(target.section, target.field))
    throw new AppError(
      "VALIDATION",
      "This Profile has no field for that answer"
    )
  if (value.type === "text") {
    const text = value.text.trim()
    if (!text)
      throw new AppError("VALIDATION", "An empty value cannot be saved")
    return { [target.field]: text }
  }
  if (value.type === "money" && target.section === "preferences")
    return { [target.field]: value.amount }
  throw new AppError(
    "VALIDATION",
    "This Profile field cannot hold that kind of answer"
  )
}
