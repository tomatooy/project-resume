import type { Json } from "@workspace/autofill"
import type {
  AutofillModels,
  JudgeOutput,
  ModelField,
} from "@workspace/resume-core"
import {
  type EntryType,
  type NoulResponse,
  type Question,
  type SystemOneResult,
  type TypeSafeClient,
  choice,
  noul,
} from "@workspace/typesafe"

import { DATA_RULE, dataBlock } from "../prompts/autofill"

/**
 * Retries cut to fit the infer deadline (spec 12.1): one retry, a short
 * backoff, and no waiting out a long Retry-After.
 */
const RETRY = {
  maxRetries: 1,
  backoffInitialMs: 250,
  backoffMaxMs: 500,
  respectRetryAfter: false,
}

const PICK =
  "Which option fits the applicant for this field on a job application? Decide from the applicant's records in the state."
const SELECT =
  "Should the applicant select this option for this field on a job application? Decide from the applicant's records in the state."
const OPEN = "Is this an open-ended question that needs a written answer?"

const INSUFFICIENT =
  "The applicant's records do not show which option applies to them."
const APPLICANT =
  "Only the applicant may answer this themselves, such as a legal attestation, consent, criminal history, a signature or an ID number."

const SELECTED = {
  true: "The records show this option applies to the applicant.",
  false: "The records show this option does not apply to the applicant.",
}
const WRITTEN = {
  true: "It asks for an answer in the applicant's own words, such as a motivation, an explanation or a description.",
  false:
    "It asks for a short fact, such as a name, a date, a number, a link, or a yes or no.",
}

/** Page text reaches Jev only inside data blocks (spec 12.1, 12.3). */
const fieldLines = ({ label, help }: ModelField): string[] => [
  `Field label: ${dataBlock(label)}`,
  ...(help ? [`Help text: ${dataBlock(help)}`] : []),
]

const instructions = (ask: string, lines: string[]): string =>
  [ask, ...lines, DATA_RULE].join("\n")

/** `o1` to `oN` describe the page's options; two more keys say why none fits. */
const choiceCriteria = (options: string[]): Record<string, EntryType> => ({
  ...Object.fromEntries(
    options.map((option, k) => [`o${k + 1}`, dataBlock(option)])
  ),
  insufficient: INSUFFICIENT,
  applicant: APPLICANT,
})

/** Jev takes text, an object or an array as its state, never a bare scalar. */
const stateOf = (context: Json): EntryType =>
  typeof context === "number" || typeof context === "boolean"
    ? String(context)
    : context

type Answer = SystemOneResult<Record<string, Question>>["answers"][string]
type Verdict = JudgeOutput["choices"][string]

/** `oK` is option K - 1; `insufficient` and `applicant` choose none. */
function verdictOf(answer: Answer | undefined, count: number): Verdict | null {
  if (answer?.type !== "choice") return null
  const { choice: label, confidence } = answer
  if (label === "applicant")
    return { option: null, applicant: true, confidence }
  if (label === "insufficient")
    return { option: null, applicant: false, confidence }
  const match = /^o(\d+)$/.exec(label)
  const option = match ? Number(match[1]) - 1 : -1
  if (option < 0 || option >= count) return null
  return { option, applicant: false, confidence }
}

const yesOf = (answer: Answer | undefined): NoulResponse | null =>
  answer?.type === "noul" ? answer : null

/**
 * The judge port on Jev (spec 12.1): every closed field, multi-select option
 * and open-question check in one `systemOne` request, with the applicant
 * context as its state and page text only inside data blocks.
 */
export function createJudge(client: TypeSafeClient): AutofillModels["judge"] {
  return async ({ signal, deadline, context, choices, multi, open }) => {
    const questions: Record<string, Question> = {}
    for (const [i, item] of choices.entries()) {
      questions[`c_${i}`] = choice(
        instructions(PICK, fieldLines(item)),
        choiceCriteria(item.options)
      )
    }
    for (const [i, item] of multi.entries()) {
      for (const [k, option] of item.options.entries()) {
        questions[`m_${i}_${k}`] = noul(
          instructions(SELECT, [
            ...fieldLines(item),
            `Option: ${dataBlock(option)}`,
          ]),
          SELECTED
        )
      }
    }
    for (const [i, item] of open.entries()) {
      questions[`o_${i}`] = noul(
        instructions(OPEN, [
          ...fieldLines(item),
          item.multiline
            ? "The field is a multi-line text box."
            : "The field is a single-line input.",
        ]),
        WRITTEN
      )
    }
    if (Object.keys(questions).length === 0) {
      return {
        choices: {},
        multi: {},
        open: {},
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    }

    const { answers, usage } = await client.systemOne(
      { state: stateOf(context), questions },
      {
        signal,
        timeout: Math.max(1, deadline - Date.now()),
        retry: RETRY,
      }
    )

    const verdicts: JudgeOutput["choices"] = {}
    for (const [i, item] of choices.entries()) {
      const verdict = verdictOf(answers[`c_${i}`], item.options.length)
      if (verdict) verdicts[item.key] = verdict
    }
    // A multi-select counts only when every one of its options was answered.
    const selected: JudgeOutput["multi"] = {}
    for (const [i, item] of multi.entries()) {
      const yes: number[] = []
      for (const k of item.options.keys()) {
        const answer = yesOf(answers[`m_${i}_${k}`])
        if (!answer) break
        yes.push(answer.noul)
      }
      if (yes.length === item.options.length) selected[item.key] = yes
    }
    const written: JudgeOutput["open"] = {}
    for (const [i, item] of open.entries()) {
      const answer = yesOf(answers[`o_${i}`])
      if (answer) written[item.key] = answer.noul
    }
    return {
      choices: verdicts,
      multi: selected,
      open: written,
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      },
    }
  }
}
