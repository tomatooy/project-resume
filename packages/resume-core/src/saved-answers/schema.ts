import { z } from "zod"
import { EEO_DEFINITIONS } from "../autofill-profile/schema"
import { QuestionKindSchema, ScopeEntrySchema } from "../dom-agent/primitives"
import { normalizeQuestionText, questionKey } from "../dom-agent/question"
import { byCodeUnit, canonical, fingerprint } from "../dom-agent/fingerprint"
import { FactValueSchema } from "../dom-agent/source"

/**
 * A saved answer in the new shape: the question's own evidence plus the value.
 *
 * ADR 0001 makes the identity deterministic over wording, kind, explicit scope
 * and option signature, so there is no concept to enumerate here and no way for
 * a caller to file a company-specific question under a vocabulary member. The
 * key is derived from the evidence rather than accepted from a caller, so a
 * stored key cannot disagree with the evidence it was stored with.
 *
 * Legacy rows keep the old concept vocabulary. They are read into this shape by
 * `dom-agent/saved-answer.ts` and never rewritten in place.
 */
const MAX_TEXT = 2000
const MAX_SCOPE = 10
const MAX_OPTIONS = 200

/**
 * Length of the deterministic identity a question key is: one fingerprint, in
 * hex. Exported because the legacy reader has to tell a key in this form from
 * the free-text key the retired vocabulary wrote.
 */
export const SAVED_QUESTION_KEY_LENGTH = 16

export const SavedQuestionEvidenceSchema = z.strictObject({
  /** Original wording, preserved exactly as the page asked it. */
  text: z.string().max(MAX_TEXT),
  kind: QuestionKindSchema,
  /**
   * Scope the answer's meaning depends on: country, employer, role, time,
   * currency and period, the record it belongs to. Empty is allowed here and
   * refused by the service, so the refusal can say why instead of surfacing as
   * a shape error.
   */
  scope: z.array(ScopeEntrySchema).max(MAX_SCOPE),
  options: z
    .array(z.strictObject({ label: z.string().min(1).max(500) }))
    .max(MAX_OPTIONS),
})
export type SavedQuestionEvidence = z.infer<typeof SavedQuestionEvidenceSchema>

export const SavedQuestionSchema = SavedQuestionEvidenceSchema.extend({
  key: z.string().length(SAVED_QUESTION_KEY_LENGTH),
  /**
   * Whether this question's subject may not be answered from a source.
   *
   * Recorded when the answer is saved, so the reuse path reads a decision
   * instead of re-deriving one from whatever wording a later page happens to
   * use. Optional because a row written before this decision existed has to
   * stay readable, and the reader treats a row carrying no decision as
   * excluded: absence is not permission.
   */
  excluded: z.boolean().optional(),
})
export type SavedQuestion = z.infer<typeof SavedQuestionSchema>

export const SavedAnswerSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
  question: SavedQuestionSchema,
  /**
   * The answer as a protocol value rather than a display string, so the value
   * written into a control is the typed one. Whether a given kind of question
   * may hold it is the gate's decision at fill time.
   */
  value: FactValueSchema,
  confirmedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type SavedAnswer = z.infer<typeof SavedAnswerSchema>

export const SaveSavedAnswerSchema = z.strictObject({
  id: z.uuid().optional(),
  expectedRevision: z.number().int().nonnegative(),
  question: SavedQuestionEvidenceSchema,
  value: FactValueSchema,
  confirmed: z.literal(true),
})
export type SaveSavedAnswer = z.infer<typeof SaveSavedAnswerSchema>

export const RemoveSavedAnswerSchema = z.strictObject({
  id: z.uuid(),
  expectedRevision: z.number().int().positive(),
})
export type RemoveSavedAnswer = z.infer<typeof RemoveSavedAnswerSchema>

/**
 * The identity a page will derive for the same question, from the same
 * evidence. Derived, never stored from the wire.
 */
export function savedQuestionKey(evidence: SavedQuestionEvidence): string {
  return questionKey({
    text: evidence.text,
    kind: evidence.kind,
    scope: evidence.scope,
    options: evidence.options,
  })
}

/**
 * The subjects the Profile asks about demographically, as the words a page uses
 * for them. Its own titles are verbose and a page rarely reuses them, so the
 * subject is matched as well as the title: a question asking "Gender", "Race /
 * ethnicity" or "Disability status" has to be caught too.
 */
const DEMOGRAPHIC_WORDING =
  /\b(?:gender|sex(?:ual|es)?|race|ethnic(?:ity)?|disabilit(?:y|ies)|veteran(?:s)?|military|self[- ]identif\w*)\b/

/**
 * A category as a page spells it rather than as the Profile codes it: punctuation
 * and spacing are decoration, so "Non-binary" is the Profile's `nonbinary` and
 * "Hispanic or Latino" is its `hispanic_or_latino`.
 */
function categoryForm(text: string): string {
  return normalizeQuestionText(text).replace(/[^a-z0-9]+/g, "")
}

/**
 * The demographic answer categories the Profile itself defines, minus the two
 * definitions that are a yes or a no: "Yes" and "No" are options on ordinary
 * questions, and matching those would refuse reuse for most of a form. The
 * categories are a second signal, because a page can ask about gender without
 * using any word in `DEMOGRAPHIC_WORDING` and still offer these answers.
 */
const DEMOGRAPHIC_CATEGORIES: ReadonlySet<string> = new Set(
  EEO_DEFINITIONS.flatMap((definition) => {
    const codes: readonly string[] = definition.codes
    if (codes.every((code) => code === "yes" || code === "no")) return []
    return codes.map((code) => categoryForm(code.replaceAll("_", " ")))
  })
)

/**
 * Whether this question is demographic, whose answer may never be reused. EEO
 * is excluded from sources outright: the specification forbids answering it
 * from a bundle, and a saved answer is one.
 *
 * The new shape has no concept to test, so the decision is read from the
 * question's own evidence: the wording a page authored and the answer
 * categories it offered. Both are narrower than a classification, and a
 * demographic question using none of the subjects the Profile defines, in
 * either signal, reads as an ordinary question.
 *
 * That limit is why the decision is also recorded on the row (`excluded`): a
 * reader refuses on the row's own statement instead of re-deriving the
 * classification from wording, so a later page wording the question differently
 * cannot turn an excluded row into a source fact.
 */
export function isDemographicQuestion(question: {
  text: string
  options: readonly { label: string }[]
}): boolean {
  const wording = normalizeQuestionText(question.text)
  if (!wording) return false
  if (DEMOGRAPHIC_WORDING.test(wording)) return true
  if (
    EEO_DEFINITIONS.some(
      (definition) => normalizeQuestionText(definition.title) === wording
    )
  )
    return true
  return question.options.some((option) =>
    DEMOGRAPHIC_CATEGORIES.has(categoryForm(option.label))
  )
}

/**
 * Identity of a set of saved answers, for the source bundle. Sorted by the
 * answer's own key so the same set always hashes the same.
 */
export function savedAnswersId(answers: readonly SavedAnswer[]): string {
  return fingerprint(
    canonical(
      [...answers]
        .map((answer) => `${answer.question.key}:${answer.revision}`)
        .sort(byCodeUnit)
    )
  )
}
