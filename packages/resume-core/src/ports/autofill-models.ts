import type {
  ApplicantSource,
  Control,
  Json,
  NoteMergeProposal,
} from "@workspace/autofill"

/** Token counts for the run row. */
export type ModelUsage = { inputTokens: number; outputTokens: number }

/** Keeps completed provider usage when an output cannot be used. */
export class AutofillModelError extends Error {
  readonly usage: ModelUsage
  readonly isRetryable: boolean
  readonly finishReason: string | undefined
  readonly outputChars: number | undefined

  constructor(
    cause: unknown,
    details: {
      usage: ModelUsage
      retryable?: boolean
      finishReason?: string
      outputChars?: number
    }
  ) {
    super("Autofill model call failed", { cause })
    this.name = "AutofillModelError"
    this.usage = { ...details.usage }
    this.isRetryable = details.retryable ?? false
    this.finishReason = details.finishReason
    this.outputChars = details.outputChars
  }
}

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

export type JudgeItem = ModelField & {
  options: string[]
  /** A server-owned instruction to resolve a location entity. */
  intent?: "location"
  /** Server classification, for tracing the how-heard fallback. */
  guess?: boolean
  /** Answer mode: the numbered question the field was asked as. */
  asked?: { number: number; text: string }
}

export type JudgeInput = ModelCall & {
  context: Json
  /**
   * Answer mode: the applicant's reply to the numbered questions. The reply
   * decides each field; the context only helps read it.
   */
  reply?: { text: string }
  choices: JudgeItem[]
  multi: JudgeItem[]
  open: (ModelField & { multiline: boolean })[]
}

/**
 * `option` is an index into that item's `options`, null when the context is
 * not enough, and `probabilities` holds each option's probability in option
 * order, whatever was chosen. `multi` holds a yes probability per option and
 * `open` one per field: is this an open-ended question that needs a written
 * answer? In answer mode, `unmatched` says the reply answers the field with
 * something no option says, and `addressed` holds, per multi-select, the
 * probability that the reply answers it.
 */
export type JudgeOutput = {
  choices: Record<
    string,
    {
      option: number | null
      applicant: boolean
      unmatched?: boolean
      confidence: number
      probabilities?: number[]
      source?: ApplicantSource
      evidence?: string[]
      blocked?: boolean
      verification?: { support: number; contradiction: number }
    }
  >
  multi: Record<string, number[]>
  /** Notes fallback, gated by applicability and the absence of an explicit answer. */
  preferences?: Record<string, { option: number; support: number }>
  addressed?: Record<string, number>
  open: Record<string, number>
  /** A source or verification call failed; the other call's answers still count. */
  degraded?: boolean
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
    blocked?: boolean
  }[]
  degraded?: boolean
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
