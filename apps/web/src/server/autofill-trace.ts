import type { Json } from "@workspace/autofill"
import {
  type AutofillModels,
  CHOICE_MIN,
  type FillFromAnswerInput,
  type FillFromAnswerOutput,
  type JudgeInput,
  type JudgeItem,
  type JudgeOutput,
  likeliest,
  MULTI_NO,
  MULTI_YES,
  PREFERENCE_MIN,
  type QuestionsOutput,
  type ShortTextInput,
  type ShortTextOutput,
  verifiedChoice,
} from "@workspace/resume-core"
import type {
  Question as JevQuestion,
  TypeSafeClient,
} from "@workspace/typesafe"
import { errorClassOf } from "./log"

/*
 * A dev-only trace of what autofill asks its models and what they answer, so
 * a run can be followed in the dev server's terminal. It prints labels,
 * options, full Jev requests and responses, so `container.ts` enables it under
 * `vite dev`, never in a build (the exception in spec 16). Errors still log
 * as their class only: SDK messages can quote the prompt.
 */

const NOTES_MAX = 3_000

type Verdict = JudgeOutput["choices"][string]

const log = (line: string, ...details: unknown[]): void => {
  console.log(`[autofill] ${line}`, ...details)
}

const quote = (text: string): string => JSON.stringify(text)

const seconds = (since: number): string =>
  `${((Date.now() - since) / 1000).toFixed(1)} s`

const objectOf = (json: Json | undefined): { [key: string]: Json } | null =>
  typeof json === "object" && json !== null && !Array.isArray(json)
    ? json
    : null

function jevStage(request: Parameters<TypeSafeClient["systemOne"]>[0]): string {
  const state = request.state
  if (typeof state === "object" && state !== null && !Array.isArray(state)) {
    if ("reply" in state) return "Reply"
    if ("notes" in state) return "Notes"
    if ("profile" in state) return "Profile"
  }
  if (
    Object.keys(request.questions).some(
      (key) => key.startsWith("support_") || key.startsWith("contradiction_")
    )
  )
    return "Verification"
  return "Other"
}

type JevResultLabels = {
  question: Json
  help?: string
  optionLabels: Record<string, string>
  evaluatedOption?: string
  proposedAnswer?: string
}

const criterionLabel = (value: Json | undefined, key: string): string =>
  typeof value === "string"
    ? value.replace(/^<<<([\s\S]*)>>>$/, "$1")
    : value == null
      ? key
      : JSON.stringify(value)

/** Read the existing data blocks without adding metadata to the model request. */
function jevResultLabels(question: JevQuestion): JevResultLabels {
  const instructions =
    typeof question.instructions === "string" ? question.instructions : ""
  const block = (label: string): string | undefined =>
    new RegExp(`^${label}: <<<([\\s\\S]*?)>>>`, "m").exec(instructions)?.[1]
  const options =
    /^Available options: (<<<[\s\S]*?>>>((?: \/ <<<[\s\S]*?>>>)*))/m.exec(
      instructions
    )?.[1]
  const optionLabels: Record<string, string> = {}
  if (options) {
    for (const [index, match] of [
      ...options.matchAll(/<<<([\s\S]*?)>>>/g),
    ].entries()) {
      if (match[1] !== undefined) optionLabels[`o${index + 1}`] = match[1]
    }
  }
  if (question.type === "choice" || !options) {
    for (const [key, value] of Object.entries(question.criteria ?? {})) {
      optionLabels[key] = criterionLabel(value, key)
    }
  }
  return {
    question: block("Field(?: label)?") ?? question.instructions ?? null,
    help: block("Help(?: text)?"),
    optionLabels,
    evaluatedOption: block("Option"),
    proposedAnswer: block("Proposed answer"),
  }
}

/** Capture Jev before verdict conversion drops non-option probabilities. */
export function traceJevClient(client: TypeSafeClient): TypeSafeClient {
  return {
    systemOne: (request, options) => {
      const prefix = `jev [${jevStage(request)}] ${crypto.randomUUID()}`
      log(`${prefix} request:\n${JSON.stringify(request, null, 2)}`)
      return client.systemOne(request, options).map((response) => {
        const answers = Object.fromEntries(
          Object.entries(response.answers).map(([key, answer]) => {
            const question = request.questions[key]
            if (!question) return [key, answer]
            const labels = jevResultLabels(question)
            return [
              key,
              {
                ...answer,
                ...labels,
                ...(answer.type === "choice"
                  ? {
                      choiceLabel:
                        labels.optionLabels[answer.choice] ?? answer.choice,
                    }
                  : {}),
              },
            ]
          })
        )
        log(
          `${prefix} response:\n${JSON.stringify({ ...response, answers }, null, 2)}`
        )
        return response
      })
    },
  }
}

/** Which records the model sees, and the Notes in full. */
function traceRecords(context: Json): void {
  const records = objectOf(context)
  log(
    `  records: profile ${records?.profile ? "yes" : "no"}, resume ${records?.resume ? "yes" : "no"}; Notes and structured records are evaluated separately`
  )
  const notes = records?.notes
  if (typeof notes === "string" && notes.trim() !== "")
    log(`  notes (${notes.length} chars):\n${notes.slice(0, NOTES_MAX)}`)
  else log("  notes: empty")
}

/** What the model chose for a one-choice field, in words. */
function picked(item: JudgeItem, verdict: Verdict | undefined): string {
  if (!verdict) return "nothing"
  if (verdict.applicant) return "applicant only"
  if (verdict.unmatched) return "none of the options"
  if (verdict.option === null) return "insufficient records"
  return quote(item.options[verdict.option] ?? `option ${verdict.option + 1}`)
}

/** The option the tiers would guess, with its probability. */
function likeliestOption(
  options: string[],
  probabilities: readonly number[]
): string | null {
  const best = likeliest(probabilities)
  const option = options[best]
  return option === undefined
    ? null
    : `${quote(option)} (${(probabilities[best] ?? 0).toFixed(2)})`
}

/** A supported Notes preference, separate from the factual scores. */
function preferenceResult(
  item: JudgeItem,
  preference: NonNullable<JudgeOutput["preferences"]>[string] | undefined
): string | null {
  if (!preference || preference.support < PREFERENCE_MIN) return null
  const option = item.options[preference.option]
  return option === undefined
    ? null
    : `fill from Notes fallback: ${quote(option)} (support ${preference.support.toFixed(2)})`
}

function choiceResult(
  item: JudgeItem,
  verdict: Verdict | undefined,
  preference: NonNullable<JudgeOutput["preferences"]>[string] | undefined
): string {
  if (verdict?.blocked)
    return "question: Notes and the records disagree, and the records name no source"
  if (verdict?.unmatched)
    return "question: the explicit answer does not match an option"
  const direct =
    verdict &&
    verdict.option !== null &&
    (verdict.confidence >= CHOICE_MIN || verifiedChoice(verdict)) &&
    item.options[verdict.option] !== undefined
  const preferred = preferenceResult(item, preference)
  if (preferred && !verdict?.applicant && !direct) return preferred
  if (!verdict) return "question: the model gave no usable answer"
  if (verdict.applicant)
    return "left to you on the page: only the applicant may answer"
  if (direct) return "fill"
  const guessed =
    item.guess && verdict.probabilities
      ? likeliestOption(item.options, verdict.probabilities)
      : null
  if (guessed) return `fill from how-heard fallback: ${guessed}`
  return verdict.option === null
    ? "question: the records do not show the answer"
    : `question: confidence is under ${CHOICE_MIN}`
}

function traceVerdicts(input: JudgeInput, output: JudgeOutput): void {
  const answering = input.reply !== undefined
  for (const item of input.choices) {
    const verdict = output.choices[item.key]
    log(`  ${item.key} ${quote(item.label)} (one choice)`)
    log(`     options: ${item.options.join(" | ")}`)
    if (verdict?.source)
      log(
        `     source: ${verdict.source}; evidence considered: ${verdict.evidence?.join(", ") ?? "none"}`
      )
    if (verdict?.verification)
      log(
        `     verification: support ${verdict.verification.support.toFixed(2)}, contradiction ${verdict.verification.contradiction.toFixed(2)}`
      )
    const scores = verdict?.probabilities
    if (scores)
      log(
        `     scores: ${item.options.map((option, i) => `${option} ${(scores[i] ?? 0).toFixed(2)}`).join(" · ")}`
      )
    log(
      `     picked ${picked(item, verdict)}${verdict ? `, confidence ${verdict.confidence.toFixed(2)}` : ""}${answering ? "" : ` -> ${choiceResult(item, verdict, output.preferences?.[item.key])}`}`
    )
  }
  for (const item of input.multi) {
    const yes = output.multi[item.key]
    const preferred = answering
      ? null
      : preferenceResult(item, output.preferences?.[item.key])
    log(
      `  ${item.key} ${quote(item.label)} (select all; each option is judged with the full option list)`
    )
    if (!yes || yes.length !== item.options.length) {
      log(`     -> ${preferred ?? "question: some option got no answer"}`)
      continue
    }
    log(
      `     ${item.options
        .map((option, i) => {
          const p = yes[i] ?? 0
          const call =
            p >= MULTI_YES ? "select" : p <= MULTI_NO ? "leave" : "unsure"
          return `${option} ${p.toFixed(2)} ${call}`
        })
        .join(" · ")}`
    )
    if (answering) {
      const addressed = output.addressed?.[item.key]
      log(`     the reply answers it: ${addressed?.toFixed(2) ?? "?"}`)
      continue
    }
    const sure = item.options.filter((_, i) => (yes[i] ?? 0) >= MULTI_YES)
    const uncertain = yes.some((p) => p > MULTI_NO && p < MULTI_YES)
    const guessed = item.guess ? likeliestOption(item.options, yes) : null
    const result =
      sure.length > 0
        ? `fill: ${sure.map(quote).join(", ")}${uncertain ? "; uncertain options left unselected" : ""}`
        : (preferred ??
          (guessed
            ? `fill from how-heard fallback: ${guessed}`
            : `question: no option reaches ${MULTI_YES}`))
    log(`     -> ${result}`)
  }
  for (const item of input.open) {
    const p = output.open[item.key]
    log(
      `  ${item.key} ${quote(item.label)} (${item.multiline ? "textarea" : "single line"}): needs a written answer ${p?.toFixed(2) ?? "?"}`
    )
  }
}

function traceShort(input: ShortTextInput, output: ShortTextOutput): void {
  for (const field of input.fields) {
    const answer = output.answers.find(({ key }) => key === field.key)
    const value = answer?.value?.trim() ?? ""
    const result = answer?.applicant
      ? "only the applicant may answer"
      : value !== ""
        ? `${quote(value)} from ${answer?.evidence.join(", ") || "no source (not used)"}`
        : "(empty) -> question"
    log(`  ${field.key} ${quote(field.label)} (${field.control}) -> ${result}`)
  }
}

function traceQuestions(output: QuestionsOutput): void {
  for (const question of output.questions)
    log(
      `  ${quote(question.text)} covers ${question.keys.join(", ")}${question.options.length > 0 ? `; options: ${question.options.join(" | ")}` : ""}${question.companySpecific ? " (company-specific)" : ""}`
    )
}

function traceFilled(
  input: FillFromAnswerInput,
  output: FillFromAnswerOutput
): void {
  for (const field of input.fields) {
    const value = output.answers.find(({ key }) => key === field.key)?.value
    log(
      `  ${field.key} ${quote(field.label)} (${field.control}) -> ${value ? quote(value) : "(empty)"}`
    )
  }
}

/** Runs one model call and says how long it took or why it failed. */
async function timed<T>(name: string, call: () => Promise<T>): Promise<T> {
  const started = Date.now()
  try {
    const result = await call()
    log(`${name} answered in ${seconds(started)}`)
    return result
  } catch (error) {
    log(
      `${name} failed after ${seconds(started)}, so its fields become questions: ${errorClassOf(error)}`
    )
    throw error
  }
}

/** The same models, with each call and its answer printed. */
export function traceAutofillModels(models: AutofillModels): AutofillModels {
  return {
    get model() {
      return models.model
    },
    ready: () => {
      const ready = models.ready()
      if (!ready.judge || !ready.text)
        log(
          `models: judge (TYPESAFE_API_KEY) ${ready.judge ? "ready" : "not configured"}, text (DEEPSEEK_API_KEY) ${ready.text ? "ready" : "not configured"}`
        )
      return ready
    },
    judge: async (input) => {
      log(
        `judge${input.reply ? " (reading your reply)" : ""}: ${input.choices.length} one-choice, ${input.multi.length} select-all, ${input.open.length} open-question check(s)`
      )
      if (input.reply) log(`  your reply: ${quote(input.reply.text)}`)
      traceRecords(input.context)
      const output = await timed("judge", () => models.judge(input))
      traceVerdicts(input, output)
      return output
    },
    shortText: async (input) => {
      log(`short text: ${input.fields.length} field(s)`)
      const output = await timed("short text", () => models.shortText(input))
      traceShort(input, output)
      return output
    },
    questions: async (input) => {
      log(`question list: ${input.fields.length} field(s) to ask about`)
      const output = await timed("question list", () => models.questions(input))
      traceQuestions(output)
      return output
    },
    fillFromAnswer: async (input) => {
      log(
        `fill from your reply: ${input.fields.length} field(s); reply ${quote(input.text)}`
      )
      const output = await timed("fill from your reply", () =>
        models.fillFromAnswer(input)
      )
      traceFilled(input, output)
      return output
    },
    mergeNotes: (input) => models.mergeNotes(input),
    generate: (input) => models.generate(input),
  }
}
