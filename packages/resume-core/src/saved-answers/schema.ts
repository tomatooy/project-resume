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
 * Whether this wording is a demographic question, which may never be saved for
 * reuse. EEO is excluded from sources outright: the specification forbids
 * answering it from a bundle, and a saved answer is one.
 *
 * The new shape has no concept to test, so this matches the question's own
 * wording against the Profile's definition titles. That is narrower than the
 * retired concept test: a page that words a demographic question differently is
 * not caught here, and the answers to it stay what they always were, an
 * explicit per-application choice by the user.
 */
export function isDemographicQuestion(text: string): boolean {
  const wanted = normalizeQuestionText(text)
  if (!wanted) return false
  return EEO_DEFINITIONS.some(
    (definition) => normalizeQuestionText(definition.title) === wanted
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
