import {
  type AutofillVendor,
  type Control,
  classifyField,
  type FieldDescriptor,
  type Fill,
  LIMITS,
  type Option,
  plainQuestions,
  type Question,
} from "@workspace/autofill"
import { z } from "zod"

import type {
  FillFromAnswerInput,
  FillFromAnswerOutput,
  JudgeInput,
  JudgeItem,
  JudgeOutput,
  ModelField,
  QuestionsInput,
  QuestionsOutput,
  ShortTextInput,
  ShortTextOutput,
} from "../ports/autofill-models"

/** A closed answer fills at this confidence or above (spec 12.1). */
export const CHOICE_MIN = 0.8
/** Evidence checks are Noul probabilities, separate from choice confidence. */
export const SUPPORT_MIN = 0.9
export const CONTRADICTION_MAX = 0.1

export function verifiedChoice(
  verdict: JudgeOutput["choices"][string]
): boolean {
  return Boolean(
    verdict.verification &&
      verdict.verification.support >= SUPPORT_MIN &&
      verdict.verification.contradiction <= CONTRADICTION_MAX
  )
}
/** Notes preferences need both applicability and no explicit answer. */
export const PREFERENCE_MIN = 0.8
/** Per-option thresholds for confident selection or rejection. */
export const MULTI_YES = 0.6
export const MULTI_NO = 0.2
/** A reply must clearly address the field before being called unmatched. */
const ANSWERED_MIN = 0.8
/**
 * Yes probabilities that make a field an open question: above TEXTAREA_OPEN
 * for a textarea, LINE_OPEN or above for a single-line input.
 */
export const TEXTAREA_OPEN = 0.2
export const LINE_OPEN = 0.8
/** The infer deadline, and the part of it the judge and short text get. */
export const INFER_MS = 15_000
export const JUDGE_MS = 10_000
/** The answer's fill and merge deadlines, and the draft's (spec 14.1). */
export const ANSWER_FILL_MS = 15_000
export const ANSWER_MERGE_MS = 20_000
export const GENERATE_MS = 30_000

/** The Fill schema's limit on a search query and target. */
const SEARCH_MAX = 200
/** The Question schema's limit on its text. */
const QUESTION_MAX = 500
/** A single checkbox is judged as a choice between these, in this order. */
const CHECK_OPTIONS = ["Yes", "No"]

/**
 * Where a field goes for its answer: the judge for `choice`, `check` and
 * `multi`, short text for `search` and `text` (the judge also says whether a
 * text input or textarea is an open question), and the page for closed fields
 * whose options never loaded.
 */
type Lane = "choice" | "check" | "multi" | "search" | "text" | "page"

/**
 * A field AI may see, with the key models know it by. `guess` marks a "how
 * did you hear about us" choice or multi-select: a wrong answer there costs
 * little, so it takes the judge's likeliest option instead of becoming a
 * question (spec 5.4).
 */
export type KeyedField = {
  key: string
  field: FieldDescriptor
  lane: Lane
  guess: boolean
}

/** Where each field AI saw ends up, by field id in page order. */
export type Settled = {
  fills: Fill[]
  write: string[]
  page: string[]
  ask: string[]
}

type ShortAnswer = ShortTextOutput["answers"][number]
type Verdict = JudgeOutput["choices"][string]
type Outcome = Fill | "write" | "page" | "ask"

/**
 * The fields AI may see: empty, and in the normal zone by the server's own
 * classifier, so forbidden, salary, write and file fields never reach a
 * model whatever the extension sent.
 */
export function aiFields(
  vendor: AutofillVendor,
  fields: FieldDescriptor[]
): FieldDescriptor[] {
  return fields.filter(
    (field) => !field.hasValue && classifyField(vendor, field).zone === "normal"
  )
}

function laneOf(field: FieldDescriptor): Lane {
  switch (field.control) {
    case "checkbox":
      return "check"
    case "select":
    case "combobox":
    case "radio":
    case "checkboxes":
      if ((field.options ?? []).length > 0) {
        return field.control === "checkboxes" || field.multiple === true
          ? "multi"
          : "choice"
      }
      // A search box: marked searchable, or a combobox that lists nothing
      // until typed into.
      return field.searchable === true ||
        (field.control === "combobox" && field.optionsPending !== true)
        ? "search"
        : "page"
    case "file":
      return "page"
    default:
      return "text"
  }
}

/** Text inputs and textareas may be open questions; typed inputs never are. */
const mayBeOpen = (field: FieldDescriptor): boolean =>
  field.control === "text" || field.control === "textarea"

/** Keys are positions (`f1`, `f2`, ...), so page ids never reach a model. */
export function keyFields(
  vendor: AutofillVendor,
  fields: FieldDescriptor[]
): KeyedField[] {
  return fields.map((field, i) => {
    const lane = laneOf(field)
    const guess =
      (lane === "choice" || lane === "multi") &&
      classifyField(vendor, field).key === "source.how-heard"
    return { key: `f${i + 1}`, field, lane, guess }
  })
}

const modelField = ({ key, field }: KeyedField): ModelField => ({
  key,
  label: field.label,
  help: field.help,
})

const labels = (field: FieldDescriptor): string[] =>
  (field.options ?? []).map(({ label }) => label)

/** What the judge and short text are asked, in page order. */
export function modelInputs(keyed: KeyedField[]): {
  judge: Pick<JudgeInput, "choices" | "multi" | "open">
  short: ShortTextInput["fields"]
} {
  const choices: JudgeItem[] = []
  const multi: JudgeItem[] = []
  const open: JudgeInput["open"] = []
  const short: ShortTextInput["fields"] = []
  for (const item of keyed) {
    const { field, lane } = item
    const judged = {
      ...modelField(item),
      ...(item.guess ? { guess: true } : {}),
    }
    if (lane === "choice" || lane === "check") {
      const options = lane === "check" ? CHECK_OPTIONS : labels(field)
      choices.push({ ...judged, options })
    }
    if (lane === "multi") multi.push({ ...judged, options: labels(field) })
    if (lane === "text" && mayBeOpen(field)) {
      open.push({
        ...modelField(item),
        multiline: field.control === "textarea",
      })
    }
    if (lane === "text" || lane === "search") {
      short.push({
        ...modelField(item),
        control: field.control,
        maxLength: field.maxLength,
      })
    }
  }
  return { judge: { choices, multi, open }, short }
}

/** The asked fields as the question list sees them. */
export function questionFields(
  keyed: KeyedField[],
  ask: string[]
): QuestionsInput["fields"] {
  const asked = new Set(ask)
  return keyed
    .filter(({ field }) => asked.has(field.id))
    .map((item) => ({ ...modelField(item), options: labels(item.field) }))
}

/**
 * Applies the tiers (spec 12.1, 12.2) to what the models said. A null output
 * is a call that failed: the fields that needed it are asked, and the rest
 * keep what the other call found.
 */
export function settle(
  keyed: KeyedField[],
  judged: JudgeOutput | null,
  short: ShortTextOutput | null
): Settled {
  const answers = new Map(
    (short?.answers ?? []).map((answer) => [answer.key, answer])
  )
  const settled: Settled = { fills: [], write: [], page: [], ask: [] }
  for (const item of keyed) {
    const outcome = outcomeOf(item, judged, answers.get(item.key))
    if (typeof outcome === "string") settled[outcome].push(item.field.id)
    else settled.fills.push(outcome)
  }
  return settled
}

function outcomeOf(
  { key, field, lane, guess }: KeyedField,
  judged: JudgeOutput | null,
  answer: ShortAnswer | undefined
): Outcome {
  switch (lane) {
    case "page":
      return "page"
    case "choice":
    case "check": {
      const verdict = judged?.choices[key]
      if (verdict?.blocked || verdict?.unmatched) return "ask"
      const outcome = choiceOutcome(field, lane, verdict)
      if (typeof outcome !== "string" || outcome === "page") return outcome
      const preference = judged?.preferences?.[key]
      if (preference && preference.support >= PREFERENCE_MIN) {
        const preferred = choiceOutcome(field, lane, {
          option: preference.option,
          confidence: preference.support,
          applicant: false,
        })
        if (typeof preferred !== "string") return preferred
      }
      return guess ? guessChoice(field, verdict) : outcome
    }
    case "multi": {
      const yes = judged?.multi[key]
      const outcome = multiOutcome(field, yes)
      if (typeof outcome !== "string") return outcome
      const preference = judged?.preferences?.[key]
      const option = preference && field.options?.[preference.option]
      if (option && preference.support >= PREFERENCE_MIN)
        return optionsFill(field, [option])
      return guess ? guessMulti(field, yes) : outcome
    }
    case "search":
      return shortOutcome(answer, (value) => searchFill(field, value))
    case "text":
      if (mayBeOpen(field)) {
        if (!judged) return "ask"
        if (isOpen(field, judged.open[key] ?? 0)) return "write"
      }
      return shortOutcome(answer, (value) => textFill(field, value))
  }
}

const base = (field: FieldDescriptor): Pick<Fill, "fieldId" | "source"> => ({
  fieldId: field.id,
  source: "ai",
})

function optionsFill(field: FieldDescriptor, chosen: Option[]): Fill {
  return {
    ...base(field),
    kind: "options",
    optionIds: chosen.map(({ id }) => id),
    labels: chosen.map(({ label }) => label),
  }
}

function choiceOutcome(
  field: FieldDescriptor,
  lane: "choice" | "check",
  verdict: Verdict | undefined
): Outcome {
  if (!verdict) return "ask"
  const { option, applicant, confidence } = verdict
  if (applicant) return "page"
  if (
    verdict.blocked ||
    option === null ||
    !(confidence >= CHOICE_MIN || verifiedChoice(verdict))
  )
    return "ask"
  if (lane === "check") {
    return option === 0 || option === 1
      ? { ...base(field), kind: "check", checked: option === 0 }
      : "ask"
  }
  const chosen = (field.options ?? [])[option]
  return chosen ? optionsFill(field, [chosen]) : "ask"
}

/** Uncertain options do not block the supported selections. */
function multiOutcome(
  field: FieldDescriptor,
  yes: number[] | undefined
): Outcome {
  const options = field.options ?? []
  if (!yes || yes.length !== options.length) return "ask"
  const chosen = options.filter((_, i) => (yes[i] ?? 0) >= MULTI_YES)
  return chosen.length > 0 ? optionsFill(field, chosen) : "ask"
}

/**
 * The index of the highest probability above zero, the first on a tie, or -1
 * when there is none.
 */
export function likeliest(probabilities: readonly number[]): number {
  let best = -1
  let top = 0
  for (const [i, p] of probabilities.entries()) {
    if (p > top) {
      best = i
      top = p
    }
  }
  return best
}

function likeliestFill(
  field: FieldDescriptor,
  probabilities: number[]
): Outcome {
  const chosen = (field.options ?? [])[likeliest(probabilities)]
  return chosen ? optionsFill(field, [chosen]) : "ask"
}

/**
 * A "how did you hear" choice: what `choiceOutcome` fills, else the option
 * the judge found likeliest, however unsure. With no answer, or no option
 * above zero, it is asked.
 */
function guessChoice(
  field: FieldDescriptor,
  verdict: Verdict | undefined
): Outcome {
  const outcome = choiceOutcome(field, "choice", verdict)
  if (typeof outcome !== "string" || !verdict?.probabilities) return outcome
  return likeliestFill(field, verdict.probabilities)
}

/**
 * A "how did you hear" multi-select: the options at MULTI_YES or above, else
 * the likeliest one, however unsure. Options left unanswered still make it a
 * question.
 */
function guessMulti(
  field: FieldDescriptor,
  yes: number[] | undefined
): Outcome {
  const options = field.options ?? []
  if (!yes || yes.length !== options.length) return "ask"
  const sure = options.filter((_, i) => (yes[i] ?? 0) >= MULTI_YES)
  return sure.length > 0 ? optionsFill(field, sure) : likeliestFill(field, yes)
}

/** A textarea is open above TEXTAREA_OPEN, a single-line input from LINE_OPEN. */
const isOpen = (field: FieldDescriptor, yes: number): boolean =>
  field.control === "textarea" ? yes > TEXTAREA_OPEN : yes >= LINE_OPEN

/**
 * A short answer fills only with evidence and a value that fits the field;
 * one only the applicant can give goes to the page.
 */
function shortOutcome(
  answer: ShortAnswer | undefined,
  fill: (value: string) => Fill | null
): Outcome {
  if (!answer) return "ask"
  if (answer.applicant) return "page"
  if (answer.blocked) return "ask"
  const value = answer.value?.trim() ?? ""
  if (value === "" || answer.evidence.length === 0) return "ask"
  return fill(value) ?? "ask"
}

const EMAIL = z.email()
const HTTP_URL = z.httpUrl()
const ISO_DATE = z.iso.date()
const NUMBER = /^-?\d+(\.\d+)?$/

/** Format checks for typed inputs (spec 12.2); other controls check length only. */
const FORMATS: Partial<Record<Control, (value: string) => boolean>> = {
  email: (value) => EMAIL.safeParse(value).success,
  url: (value) => HTTP_URL.safeParse(value).success,
  number: (value) => NUMBER.test(value),
  date: (value) => ISO_DATE.safeParse(value).success,
}

function textFill(field: FieldDescriptor, value: string): Fill | null {
  const limit = Math.min(field.maxLength ?? LIMITS.answer, LIMITS.answer)
  if (value.length > limit) return null
  const valid = FORMATS[field.control]?.(value) ?? true
  return valid ? { ...base(field), kind: "text", value } : null
}

function searchFill(field: FieldDescriptor, value: string): Fill | null {
  const limit = Math.min(field.maxLength ?? SEARCH_MAX, SEARCH_MAX)
  if (value.length > limit) return null
  return { ...base(field), kind: "search", query: value, target: value }
}

const squash = (text: string): string => text.replace(/\s+/g, " ").trim()

/**
 * The question list (spec 6.4). Each model item keeps the asked fields it
 * names that no earlier item took, and is dropped when none are left or its
 * text or options do not fit the Question schema. Asked fields no item covers
 * get plain questions. Company-specific items sort last. Model items are
 * numbered q1, q2, ... in final order; plain ones keep p1, p2, ...
 */
export function questionList(
  keyed: KeyedField[],
  ask: string[],
  items: QuestionsOutput["questions"]
): Question[] {
  const asked = new Set(ask)
  const byKey = new Map(keyed.map(({ key, field }) => [key, field]))
  const taken = new Set<string>()
  const model: Omit<Question, "id">[] = []
  for (const item of items) {
    const text = squash(item.text)
    const fits =
      text !== "" &&
      text.length <= QUESTION_MAX &&
      item.options.length <= LIMITS.options &&
      item.options.every((option) => option.length <= LIMITS.option)
    if (!fits) continue
    const covered: FieldDescriptor[] = []
    for (const key of item.keys) {
      const field = byKey.get(key)
      if (field && asked.has(field.id) && !taken.has(field.id)) {
        taken.add(field.id)
        covered.push(field)
      }
    }
    if (covered.length === 0) continue
    model.push({
      text,
      original: covered.map(({ id, label }) => ({ fieldId: id, label })),
      ...(item.options.length > 0 ? { options: item.options } : {}),
      companySpecific: item.companySpecific,
    })
  }
  const fields = keyed.map(({ field }) => field)
  const plain = plainQuestions(
    fields,
    ask.filter((id) => !taken.has(id))
  )
  const general = model.filter((question) => !question.companySpecific)
  const specific = model.filter((question) => question.companySpecific)
  const numbered =
    (from: number) =>
    (question: Omit<Question, "id">, i: number): Question => ({
      id: `q${from + i + 1}`,
      ...question,
    })
  return [
    ...general.map(numbered(0)),
    ...plain,
    ...specific.map(numbered(general.length)),
  ]
}

/** A question a model may read, with its number in the panel's list. */
export type ReadableQuestion = { number: number; question: Question }

/**
 * The questions a model may read (spec 12.3): every field a question names is
 * in the normal zone, checked against both the request's descriptor and the
 * question's original label, which remains when the field is gone.
 * Each keeps its number in the request's list.
 */
export function readableQuestions(
  vendor: AutofillVendor,
  fields: FieldDescriptor[],
  questions: Question[]
): ReadableQuestion[] {
  const byId = new Map(fields.map((field) => [field.id, field]))
  const normal = (field: FieldDescriptor) =>
    classifyField(vendor, field).zone === "normal"
  const readable = (question: Question) =>
    question.original.every(({ fieldId, label }) => {
      const sent = byId.get(fieldId)
      const named: FieldDescriptor = {
        id: fieldId,
        label,
        control: "text",
        required: false,
        hasValue: false,
      }
      return (!sent || normal(sent)) && normal(named)
    })
  return questions.flatMap((question, i) =>
    readable(question) ? [{ number: i + 1, question }] : []
  )
}

/**
 * The fields an answer may fill: those AI may see that a readable question
 * names, keyed as infer keys them. Closed fields whose options never loaded
 * stay on the page, and the rest keep their lanes: the judge decides choices,
 * checkboxes and multi-selects from the reply, and the fill model writes
 * search and text values.
 */
export function answerTargets(
  vendor: AutofillVendor,
  fields: FieldDescriptor[],
  readable: ReadableQuestion[]
): KeyedField[] {
  const named = new Set(
    readable.flatMap(({ question }) =>
      question.original.map(({ fieldId }) => fieldId)
    )
  )
  return keyFields(vendor, aiFields(vendor, fields)).filter(
    ({ field, lane }) => named.has(field.id) && lane !== "page"
  )
}

/**
 * What the models read about the reply, split as `modelInputs` splits infer.
 * The judge gets each closed target with the question it was asked as. The
 * fill model gets the search and text targets and every readable question, so
 * numbers in the reply resolve.
 */
export function answerInputs(
  readable: ReadableQuestion[],
  targets: KeyedField[]
): {
  judge: Pick<JudgeInput, "choices" | "multi" | "open">
  fill: Pick<FillFromAnswerInput, "questions" | "fields">
} {
  const choices: JudgeItem[] = []
  const multi: JudgeItem[] = []
  const typed: KeyedField[] = []
  for (const item of targets) {
    const { field, lane } = item
    if (lane === "page") continue
    if (lane === "search" || lane === "text") {
      typed.push(item)
      continue
    }
    const asked = readable.find(({ question }) =>
      question.original.some(({ fieldId }) => fieldId === field.id)
    )
    const judged: JudgeItem = {
      ...modelField(item),
      options: lane === "check" ? CHECK_OPTIONS : labels(field),
      ...(asked
        ? { asked: { number: asked.number, text: asked.question.text } }
        : {}),
    }
    if (lane === "multi") multi.push(judged)
    else choices.push(judged)
  }
  const keys = new Map(typed.map(({ key, field }) => [field.id, key]))
  return {
    judge: { choices, multi, open: [] },
    fill: {
      questions: readable.map(({ number, question }) => ({
        number,
        text: question.text,
        options: question.options ?? [],
        keys: question.original.flatMap(
          ({ fieldId }) => keys.get(fieldId) ?? []
        ),
      })),
      fields: typed.map((item) => ({
        ...modelField(item),
        control: item.field.control,
        options: labels(item.field),
      })),
    },
  }
}

/**
 * Fills from what the models made of the reply, in page order, as `settle`
 * does for infer. A null output is a call that failed or was not made, and
 * its fields stay open. Closed fields fill by option index: a choice or
 * checkbox at CHOICE_MIN, a multi-select with the options at MULTI_YES or
 * above. One the reply answers with something no option says marks every
 * question naming it unmatched. Search and text values pass the infer checks,
 * and one that fails them is left open.
 */
export function answerFills(
  readable: ReadableQuestion[],
  targets: KeyedField[],
  judged: JudgeOutput | null,
  written: FillFromAnswerOutput | null
): { fills: Fill[]; unmatched: string[] } {
  const given = new Map<string, string>()
  for (const { key, value } of written?.answers ?? []) {
    const text = value?.trim() ?? ""
    if (text !== "" && !given.has(key)) given.set(key, text)
  }
  const fills: Fill[] = []
  const missed = new Set<string>()
  for (const item of targets) {
    const fill = replyOutcome(item, judged, given.get(item.key))
    if (fill === "unmatched") missed.add(item.field.id)
    else if (fill) fills.push(fill)
  }
  const unmatched = readable
    .filter(({ question }) =>
      question.original.some(({ fieldId }) => missed.has(fieldId))
    )
    .map(({ question }) => question.id)
  return { fills, unmatched }
}

/** `value` is the fill model's first non-empty value for the field. */
function replyOutcome(
  { key, field, lane }: KeyedField,
  judged: JudgeOutput | null,
  value: string | undefined
): Fill | "unmatched" | null {
  switch (lane) {
    case "choice":
    case "check": {
      const verdict = judged?.choices[key]
      if (verdict?.unmatched) return "unmatched"
      const outcome = choiceOutcome(field, lane, verdict)
      return typeof outcome === "string" ? null : outcome
    }
    case "multi": {
      const yes = judged?.multi[key]
      if (!yes) return null
      const chosen = (field.options ?? []).filter(
        (_, i) => (yes[i] ?? 0) >= MULTI_YES
      )
      if (chosen.length > 0) return optionsFill(field, chosen)
      const addressed = judged?.addressed?.[key] ?? 0
      return addressed >= ANSWERED_MIN ? "unmatched" : null
    }
    case "search":
      return value === undefined ? null : searchFill(field, value)
    case "text":
      return value === undefined ? null : textFill(field, value)
    case "page":
      return null
  }
}

/** A draft's length limit, in characters or words. */
export type DraftLimit = { kind: "characters" | "words"; value: number }

const STATED_LIMIT = /(\d{1,3}(?:,\d{3})+|\d+)\s*(words|characters|chars)\b/i

/**
 * The limit a draft must fit (spec 7): `maxLength`, else one the label, then
 * the help, states ("In 300 words or less", "1,500 characters"). A stated 0
 * is no limit.
 */
export function draftLimit(field: FieldDescriptor): DraftLimit | null {
  if (field.maxLength) return { kind: "characters", value: field.maxLength }
  for (const text of [field.label, field.help ?? ""]) {
    const [, digits = "", unit = ""] = STATED_LIMIT.exec(text) ?? []
    const value = Number(digits.replaceAll(",", ""))
    if (value > 0) {
      const kind = unit.toLowerCase() === "words" ? "words" : "characters"
      return { kind, value }
    }
  }
  return null
}

/** The characters up to the end of the `words`-th word. */
function wordBudget(text: string, words: number): number {
  let count = 0
  for (const match of text.matchAll(/\S+/g)) {
    count += 1
    if (count === words) return match.index + match[0].length
  }
  return text.length
}

/**
 * Cuts a draft to its limit: unchanged when it fits, else after the last
 * sentence end that fits, else at the last word boundary, else hard. A
 * sentence end is `.`, `!` or `?` before whitespace, so "3.5" is not one.
 */
export function fitDraft(text: string, limit: DraftLimit | null): string {
  if (!limit) return text
  const budget =
    limit.kind === "words" ? wordBudget(text, limit.value) : limit.value
  if (text.length <= budget) return text
  for (let i = budget - 1; i >= 0; i--) {
    if (/[.!?]/.test(text.charAt(i)) && /\s/.test(text.charAt(i + 1))) {
      return text.slice(0, i + 1)
    }
  }
  for (let i = budget; i > 0; i--) {
    if (/\s/.test(text.charAt(i))) return text.slice(0, i).trimEnd()
  }
  return text.slice(0, budget)
}

/**
 * Fields Write with AI drafts for: text inputs and textareas a model may see,
 * whether or not they hold text, since **Replace** redrafts a filled field.
 */
export function draftable(
  vendor: AutofillVendor,
  field: FieldDescriptor
): boolean {
  if (field.control !== "text" && field.control !== "textarea") return false
  const { zone } = classifyField(vendor, field)
  return zone === "normal" || zone === "write"
}

/** A draft as its field takes it: trimmed, one line for an input, within the limit. */
export function shapeDraft(text: string, field: FieldDescriptor): string {
  const trimmed = field.control === "textarea" ? text.trim() : squash(text)
  return fitDraft(trimmed, draftLimit(field))
}
