import type { Control, Json, NoteMergeProposal } from "@workspace/autofill"

/** Token counts for the run row. */
export type ModelUsage = { inputTokens: number; outputTokens: number }

/**
 * What every call carries besides its own input: the request's abort signal
 * and its deadline in epoch ms.
 */
export type ModelCall = { signal: AbortSignal; deadline: number }

/**
 * A field as a model sees it. Keys are opaque per request (`f1`, `f2`, ...),
 * assigned by the service, so page ids never reach a model.
 */
export type ModelField = { key: string; label: string; help?: string }

export type JudgeItem = ModelField & { options: string[] }

export type JudgeInput = ModelCall & {
  context: Json
  choices: JudgeItem[]
  multi: JudgeItem[]
  open: (ModelField & { multiline: boolean })[]
}

/**
 * `option` is an index into that item's `options`, null when the context is
 * not enough. `multi` holds a yes probability per option and `open` one per
 * field: is this an open-ended question that needs a written answer?
 */
export type JudgeOutput = {
  choices: Record<
    string,
    { option: number | null; applicant: boolean; confidence: number }
  >
  multi: Record<string, number[]>
  open: Record<string, number>
  usage: ModelUsage
}

export type ShortTextInput = ModelCall & {
  context: Json
  fields: (ModelField & { control: Control; maxLength?: number })[]
}

export type ShortTextOutput = {
  answers: {
    key: string
    value: string | null
    evidence: ("resume" | "profile" | "notes")[]
    applicant: boolean
  }[]
  usage: ModelUsage
}

export type QuestionsInput = ModelCall & {
  context: Json
  company: string | null
  fields: (ModelField & { options: string[] })[]
}

export type QuestionsOutput = {
  questions: {
    text: string
    keys: string[]
    options: string[]
    companySpecific: boolean
  }[]
  usage: ModelUsage
}

/**
 * A question as the panel numbered it, so a terse answer such as "1. yes"
 * can be read against it (spec 8.2).
 */
export type NumberedQuestion = {
  number: number
  text: string
  options: string[]
}

export type FillFromAnswerInput = ModelCall & {
  context: Json
  text: string
  /** `keys` are the fields each question names that may still be filled. */
  questions: (NumberedQuestion & { keys: string[] })[]
  fields: (ModelField & { control: Control; options: string[] })[]
}

export type FillFromAnswerOutput = {
  answers: { key: string; value: string | null }[]
  usage: ModelUsage
}

export type MergeNotesInput = ModelCall & {
  numbered: string
  questions: NumberedQuestion[]
  text: string
  company: string | null
}

export type MergeNotesOutput = {
  proposal: NoteMergeProposal
  usage: ModelUsage
}

export type GenerateTextInput = ModelCall & {
  context: Json
  field: { label: string; help?: string; singleLine: boolean }
  limit: { kind: "characters" | "words"; value: number } | null
  instruction?: string
}

export type GenerateTextOutput = { text: string; usage: ModelUsage }

/** The model calls autofill makes. Page text reaches them only as data. */
export interface AutofillModels {
  /** The model id recorded on run rows. */
  readonly model: string
  ready(): { judge: boolean; text: boolean }
  judge(input: JudgeInput): Promise<JudgeOutput>
  shortText(input: ShortTextInput): Promise<ShortTextOutput>
  questions(input: QuestionsInput): Promise<QuestionsOutput>
  fillFromAnswer(input: FillFromAnswerInput): Promise<FillFromAnswerOutput>
  mergeNotes(input: MergeNotesInput): Promise<MergeNotesOutput>
  generate(input: GenerateTextInput): Promise<GenerateTextOutput>
}
