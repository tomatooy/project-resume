import { z } from "zod"
import { ScopedAnswerSchema, type ScopedAnswer } from "../autofill/contract"
import { ConceptSchema } from "../autofill/concept"
import {
  ProfileSectionSchema,
  ProfileSections,
  type ProfileSection,
} from "../autofill-profile/schema"
import { AppError } from "../domain/errors"
import { ScopeEntrySchema, type ScopeEntry } from "./primitives"
import type { FactValue } from "./source"

/**
 * A stored answer as it is read back.
 *
 * ADR 0001 makes the question identity what a source fact cites, and that
 * identity is derived from the live page rather than stored from the wire. A
 * row in the retired concept vocabulary cannot carry one: its payload is the
 * four concept fields and nothing else, and this shape is strict, so a row
 * edited by hand cannot supply one either. Every such row is therefore a
 * review, which is why the reader below has no fact to return.
 *
 * This shape is deliberately looser than the legacy contract, because it reads
 * a row that was written by an older version or edited by hand rather than one
 * this code just built. A tenant of the read path: a stored row that cannot be
 * interpreted is a review outcome, never a thrown parse error, so one odd row
 * cannot fail a whole page run. That covers a wording key of any length (the
 * legacy key was free text, the new one is sixteen characters) and a concept
 * this version no longer knows.
 */
export const StoredAnswerSchema = ScopedAnswerSchema.extend({
  meaning: z.strictObject({
    concept: z.string().min(1).max(200),
    questionKey: z.string().max(4000).optional(),
    definitionVersion: z.string().min(1).max(150).optional(),
  }),
  /** Empty is allowed here so an unusable row is reviewable, not unreadable. */
  value: z.string().max(4000),
})
export type StoredAnswer = z.infer<typeof StoredAnswerSchema>

export const ReviewAnswerSchema = z.strictObject({
  answerId: z.uuid(),
  revision: z.number().int().positive(),
  meaning: z.string().min(1).max(200),
  value: z.string().max(4000),
  scope: z.array(ScopeEntrySchema).max(10),
  /**
   * `no_question_key`: nothing can tell which question this row belongs to, so
   * it must not be generalized. Every row in the retired vocabulary lands here,
   * because the identity a fact cites is derived from the live page and that
   * vocabulary had nowhere to keep it. A leftover free-text key counts too: the
   * protocol names a saved answer by its sixteen-character identity, and free
   * text cannot be that identity.
   * `unsupported_value`: the row names a concept this version does not know, so
   * it cannot be matched safely and stays visible instead.
   * `excluded_concept`: a subject excluded from sources by decision, so it is
   * no more eligible than an unnamed row. EEO is the case today, on both
   * readers: the retired concept vocabulary names it `eeo_*`, and an
   * identity-first row records the decision on the question itself.
   */
  reason: z.enum(["no_question_key", "unsupported_value", "excluded_concept"]),
  confirmedAt: z.iso.datetime(),
})
export type ReviewAnswer = z.infer<typeof ReviewAnswerSchema>

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

/**
 * Map one stored row to what the user has to settle about it.
 *
 * Every row this can be handed is a legacy row in the retired concept
 * vocabulary, and every one of them is a review. That is structural rather
 * than a policy: the identity a source fact cites is derived from the live
 * page, and no row this reader can receive carries one. See
 * `StoredAnswerSchema` for why.
 */
export function reviewFromStoredAnswer(raw: StoredAnswer): ReviewAnswer {
  const answer = StoredAnswerSchema.parse(raw)
  const scope = scopeFromConditions(answer.conditions)
  const concept = answer.meaning.concept
  // Decision first: an excluded concept is refused whatever else the row holds,
  // so the reason the user reads names the decision rather than a shape.
  if (concept.startsWith("eeo_"))
    return reviewAnswer(answer, scope, "excluded_concept")
  if (!ConceptSchema.safeParse(concept).success)
    return reviewAnswer(answer, scope, "unsupported_value")
  return reviewAnswer(answer, scope, "no_question_key")
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
const ProfileTargetSchema = z.discriminatedUnion("kind", [
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

const AnswerDestinationSchema = z.discriminatedUnion("kind", [
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

function isFieldSection(
  section: ProfileSection
): section is (typeof FIELD_SECTIONS)[number] {
  return (FIELD_SECTIONS as readonly string[]).includes(section)
}

/** A Profile field the schema actually declares, which is what "matching" means. */
function profileFieldNames(section: ProfileSection): readonly string[] {
  if (!isFieldSection(section)) return []
  return Object.keys(ProfileSections[section].shape)
}

function profileFieldExists(section: ProfileSection, field: string): boolean {
  return profileFieldNames(section).includes(field)
}

/**
 * Whether the Profile declares this field as a number.
 *
 * There is one, `preferences.salaryAmount`, and the money branch below is the
 * only way it is filled. Text must not land in it, because the control needs
 * the number itself and the way a figure reads is not a value. The amount,
 * currency and period a salary carries are three separate fields, so nothing
 * here joins them back together.
 */
function isNumericField(section: ProfileSection, field: string): boolean {
  return section === "preferences" && field === "salaryAmount"
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
    if (isNumericField(target.section, target.field))
      throw new AppError(
        "VALIDATION",
        "This Profile field needs a number, not the way a figure reads"
      )
    return { [target.field]: text }
  }
  if (value.type === "money" && target.section === "preferences")
    return { [target.field]: value.amount }
  throw new AppError(
    "VALIDATION",
    "This Profile field cannot hold that kind of answer"
  )
}
