import { z } from "zod"
import { byCodeUnit, canonical, fingerprint } from "./fingerprint"
import {
  NodeRefSchema,
  ObservedOptionSchema,
  QuestionKindSchema,
  QuestionRefSchema,
  RecordRefSchema,
  RequirednessSchema,
  type ScopeEntry,
  ScopeEntrySchema,
} from "./primitives"

/**
 * A question as the page presents it, enumerated by the driver before any
 * semantic classification. The model interprets this; it never adds, drops or
 * hides one, so the completeness count stays deterministic.
 */
export const CandidateQuestionSchema = z.strictObject({
  ref: QuestionRefSchema,
  controlRef: NodeRefSchema,
  /** The repeated-group container this question belongs to, if any. */
  groupRef: NodeRefSchema.nullable(),
  recordRef: RecordRefSchema.nullable(),
  kind: QuestionKindSchema,
  /** Original wording, preserved exactly. */
  text: z.string().min(1).max(4000),
  description: z.string().max(4000).nullable(),
  options: z.array(ObservedOptionSchema).max(200),
  requiredness: RequirednessSchema,
  /** Conditions the page itself states, such as the country a form names. */
  scope: z.array(ScopeEntrySchema).max(10),
})

export type CandidateQuestion = z.infer<typeof CandidateQuestionSchema>

/**
 * What happened to a question. Every candidate has exactly one, and the audit
 * refuses to call a page ready while any question is unaccounted for.
 */
export const QuestionDispositionSchema = z.enum([
  "answered",
  "preserved",
  "optional_blank",
  "needs_input",
  "conflict",
  "unsupported",
  "unverified",
  "out_of_scope",
])

export type QuestionDisposition = z.infer<typeof QuestionDispositionSchema>

export function questionRefs(questions: CandidateQuestion[]): string[] {
  return questions.map((question) => question.ref)
}

/** Refs present in the page but missing a disposition. Never silently empty. */
export function unaccountedQuestions(
  questions: CandidateQuestion[],
  dispositions: Record<string, QuestionDisposition | undefined>
): string[] {
  const missing: string[] = []
  for (const question of questions)
    if (dispositions[question.ref] === undefined) missing.push(question.ref)
  return missing
}

/** True when a disposition needs no further work from anyone. */
export function questionIsSettled(
  question: CandidateQuestion,
  disposition: QuestionDisposition
): boolean {
  if (disposition === "answered" || disposition === "preserved") return true
  // Leaving a question blank is only safe when the page said it was optional.
  if (disposition === "optional_blank")
    return question.requiredness.state === "optional"
  return false
}

/**
 * The identity a saved answer attaches to. Deterministic over the page's own
 * evidence only: wording, kind, explicit scope and the observed options. No
 * browser reference and no model output takes part, so re-keying this is a
 * migration rather than a refactor.
 */
export type QuestionKeyInput = {
  text: string
  kind: CandidateQuestion["kind"]
  scope: ScopeEntry[]
  options: { label: string }[]
}

const TRAILING_MARKERS = /[\s:：*✱•·]+$/g
const LEADING_MARKERS = /^[\s*✱•·]+/g

/**
 * Wording as a person would read it: case, unicode form, runs of whitespace,
 * and the punctuation decorative required markers leave behind.
 */
export function normalizeQuestionText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u00a0\u2000-\u200b]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(TRAILING_MARKERS, "")
    .replace(LEADING_MARKERS, "")
    .trim()
}

/**
 * The canonical form a question key is derived from. Exposed so a collision or
 * a surprise difference can be read directly instead of guessed at.
 *
 * `v1` is part of the key: changing normalization or scope handling changes
 * every derived key and is therefore a migration.
 */
export function canonicalQuestion(input: QuestionKeyInput): string {
  const scope = [...input.scope]
    .map((entry) => `${entry.dimension}=${normalizeQuestionText(entry.value)}`)
    .sort(byCodeUnit)
    .join(",")
  const options = input.options
    .map((option) => normalizeQuestionText(option.label))
    .sort(byCodeUnit)
    .join("|")
  return canonical([
    "v1",
    `kind=${input.kind}`,
    `text=${normalizeQuestionText(input.text)}`,
    `scope=${scope}`,
    `options=${options}`,
  ])
}

export function questionKey(input: QuestionKeyInput): string {
  return fingerprint(canonicalQuestion(input))
}
