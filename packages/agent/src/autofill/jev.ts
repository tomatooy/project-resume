import { type Json, matchNotePreferences } from "@workspace/autofill"
import {
  type AutofillModels,
  type JudgeInput,
  type JudgeItem,
  type JudgeOutput,
  type ModelField,
  PREFERENCE_MIN,
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

import { dataBlock, IDENTITY_RULE, JEV_DATA_RULE } from "../prompts/autofill"
import { createRecordJudge } from "./jev-records"

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

const FROM_RECORDS =
  "Use state.profile and state.resume. Prefer an explicit Profile answer when they disagree; otherwise use resume evidence. Blank values are missing; false and zero are answers. Match equivalent wording. Use insufficient only when neither source contains relevant evidence for this field."
const FROM_NOTES =
  "Use only state.notes. Respect qualifiers and company scope. A stated preference supports an available preferred option. A fallback order is a filling preference, not evidence of a past event."
/** Answer mode: the reply decides, and the records only help read it. */
const FROM_REPLY = `Decide from the applicant's reply in the state, written to numbered questions they were shown. Use their records only to understand the reply, never to answer for them. ${IDENTITY_RULE}`

const PICK = "Choose the option best supported by the applicant's records."
const SELECT =
  "Do the applicant's records support this option as an answer to the field? Judge each option independently."
const OPEN = "Is this an open-ended question that needs a written answer?"
const REPLY_PICK = `Which option does the applicant's reply choose for this field on a job application? ${FROM_REPLY}`
const REPLY_SELECT = `Does the applicant's reply choose this option for this field on a job application? ${FROM_REPLY}`
const REPLY_ANSWERS = `Does the applicant's reply answer this field on a job application? ${FROM_REPLY}`

const INSUFFICIENT =
  "Neither state.profile nor state.resume contains relevant evidence for this field."
const NOTES_INSUFFICIENT =
  "state.notes contains no factual answer for this field. A fallback order alone is not a factual answer."
const APPLICANT =
  "Requires the applicant's own consent, attestation, signature, ID number or criminal-history answer."
const SILENT = "The reply does not answer this field."
const NO_OPTION =
  "The reply answers this field, but with something none of the options say."

const SELECTED = {
  true: "The records show this option applies to the applicant.",
  false: "The records show this option does not apply to the applicant.",
}
const EXPLICIT = `Does state.notes contain a fact or stated preference that answers this field, including a partial or negative answer? A fallback order alone is not a factual answer. ${FROM_NOTES}`
const EVIDENCE_SOURCE =
  "Which source contains the evidence answering this field? Use Profile when it contains an answer; otherwise use the resume. Missing Profile values do not override resume evidence."
const APPLICABLE =
  "Does the note concern the same application question as this field? Compare the information requested, not whether the note proves a past event. A preferred source of job opportunities concerns 'How did you hear about us?'. A platform used professionally is different from a source of job opportunities. If the note names an employer, the application must be known to be for that employer; generic 'the company' is not a named employer."
const CHOSEN = {
  true: "The reply chooses this option.",
  false: "The reply does not choose this option.",
}
const ANSWERED = {
  true: "The reply answers this field, whether or not it names one of the options.",
  false: "The reply does not answer this field.",
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

/** In answer mode, the question the field was asked as, so "2. yes" finds it. */
const itemLines = (item: JudgeItem): string[] => [
  ...fieldLines(item),
  `Available options: ${item.options.map(dataBlock).join(" / ")}`,
  ...(item.asked
    ? [`Asked as question ${item.asked.number}: ${dataBlock(item.asked.text)}`]
    : []),
]

const instructions = (ask: string, lines: string[]): string =>
  [ask, ...lines, JEV_DATA_RULE].join("\n")

/** `o1` to `oN` describe the page's options; the other keys say why none is chosen. */
const choiceCriteria = (
  options: string[],
  reply: boolean,
  source: RecordJudgeInput["source"]
): Record<string, EntryType> => ({
  ...Object.fromEntries(
    options.map((option, k) => [`o${k + 1}`, dataBlock(option)])
  ),
  ...(reply
    ? { insufficient: SILENT, none: NO_OPTION }
    : {
        insufficient: source === "notes" ? NOTES_INSUFFICIENT : INSUFFICIENT,
        applicant: APPLICANT,
      }),
})

/** Jev takes text, an object or an array as its state, never a bare scalar. */
const stateOf = (context: Json): EntryType =>
  typeof context === "number" || typeof context === "boolean"
    ? String(context)
    : context

export type RecordJudgeInput = JudgeInput & {
  source?: "notes" | "records"
}
/** `sources`: the record each answer came from, when Jev names one. */
export type RecordJudgeOutput = JudgeOutput & {
  sources?: Record<string, "profile" | "resume">
}
type Asked = Pick<
  RecordJudgeInput,
  "reply" | "choices" | "multi" | "open" | "source"
>
type Questions = Record<string, Question>
type PreferenceCandidate = {
  key: string
  option: number
  explicit: string
  applicable: string
}

/**
 * Every question of one request: `c_i` per choice, `m_i_k` per option of a
 * multi-select, `o_i` per open check, and in answer mode `a_i`, whether the
 * reply answers multi-select i at all.
 */
function questionsOf(
  { reply, choices, multi, open, source }: Asked,
  notes: string
): { questions: Questions; preferences: PreferenceCandidate[] } {
  const answering = reply !== undefined
  const questions: Questions = {}
  const from = source === "notes" ? FROM_NOTES : FROM_RECORDS
  for (const [i, item] of choices.entries()) {
    questions[`c_${i}`] = choice(
      instructions(answering ? REPLY_PICK : `${PICK} ${from}`, itemLines(item)),
      choiceCriteria(item.options, answering, source)
    )
  }
  for (const [i, item] of multi.entries()) {
    for (const [k, option] of item.options.entries()) {
      questions[`m_${i}_${k}`] = noul(
        instructions(answering ? REPLY_SELECT : `${SELECT} ${from}`, [
          ...itemLines(item),
          `Option: ${dataBlock(option)}`,
        ]),
        answering ? CHOSEN : SELECTED
      )
    }
    if (answering) {
      questions[`a_${i}`] = noul(
        instructions(REPLY_ANSWERS, itemLines(item)),
        ANSWERED
      )
    }
  }
  if (!answering && source === "records") {
    for (const [i, item] of [...choices, ...multi].entries()) {
      questions[`s_${i}`] = choice(
        instructions(EVIDENCE_SOURCE, fieldLines(item)),
        {
          profile: "state.profile contains evidence answering this field.",
          resume:
            "state.resume contains evidence answering this field and state.profile does not.",
          insufficient: INSUFFICIENT,
        }
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
  const preferences: PreferenceCandidate[] = []
  if (!answering) {
    for (const [i, item] of [...choices, ...multi].entries()) {
      const matches = matchNotePreferences(notes, item.options)
      if (matches.length === 0) continue
      const explicit = `e_${i}`
      questions[explicit] = noul(instructions(EXPLICIT, fieldLines(item)))
      for (const [k, match] of matches.entries()) {
        const applicable = `p_${i}_${k}`
        questions[applicable] = noul(
          instructions(APPLICABLE, [
            ...fieldLines(item),
            `Note: ${dataBlock(match.note)}`,
          ]),
          {
            true: "The note gives a preference for this field's subject and any named employer matches.",
            false:
              "The subject differs or an explicitly named employer cannot be matched.",
          }
        )
        preferences.push({
          key: item.key,
          option: item.options.indexOf(match.option),
          explicit,
          applicable,
        })
      }
    }
  }
  return { questions, preferences }
}

type Answer = SystemOneResult<Questions>["answers"][string]
type Verdict = JudgeOutput["choices"][string]

/**
 * `oK` is option K - 1; `insufficient` and `applicant` choose none, and
 * `none` says the reply names something no option says. Each option's
 * probability comes along whatever was chosen, so a "how did you hear"
 * field can still take the likeliest one.
 */
function verdictOf(answer: Answer | undefined, count: number): Verdict | null {
  if (answer?.type !== "choice") return null
  const { choice: label, confidence, probabilities: byLabel } = answer
  const probabilities = Array.from(
    { length: count },
    (_, k) => byLabel[`o${k + 1}`] ?? 0
  )
  const scored = { confidence, probabilities }
  if (label === "applicant") return { option: null, applicant: true, ...scored }
  if (label === "insufficient")
    return { option: null, applicant: false, ...scored }
  if (label === "none")
    return { option: null, applicant: false, unmatched: true, ...scored }
  const match = /^o(\d+)$/.exec(label)
  const option = match ? Number(match[1]) - 1 : -1
  if (option < 0 || option >= count) return null
  return { option, applicant: false, ...scored }
}

const yesOf = (answer: Answer | undefined): NoulResponse | null =>
  answer?.type === "noul" ? answer : null

function preferredOptions(
  answers: SystemOneResult<Questions>["answers"],
  candidates: PreferenceCandidate[]
): NonNullable<JudgeOutput["preferences"]> {
  const preferences: NonNullable<JudgeOutput["preferences"]> = {}
  const conflicts = new Set<string>()
  for (const candidate of candidates) {
    const explicit = yesOf(answers[candidate.explicit])
    const applicable = yesOf(answers[candidate.applicable])
    if (!explicit || !applicable) continue
    const support = Math.min(1 - explicit.noul, applicable.noul)
    if (support < PREFERENCE_MIN) continue
    const previous = preferences[candidate.key]
    if (previous && previous.option !== candidate.option) {
      conflicts.add(candidate.key)
    }
    preferences[candidate.key] = { option: candidate.option, support }
  }
  for (const key of conflicts) delete preferences[key]
  return preferences
}

/**
 * The judge port on Jev (spec 12.1): every closed field, multi-select option
 * and open-question check in one `systemOne` request, with the applicant
 * context as its state and page text only inside data blocks. With a
 * `reply`, the state is the reply with the records beside it, and each field
 * is decided from the reply (spec 8.2).
 */
export function createJudge(client: TypeSafeClient): AutofillModels["judge"] {
  const once = async ({
    signal,
    deadline,
    context,
    reply,
    ...asked
  }: RecordJudgeInput): Promise<RecordJudgeOutput> => {
    const notes =
      !reply &&
      context !== null &&
      typeof context === "object" &&
      !Array.isArray(context) &&
      typeof context.notes === "string"
        ? context.notes
        : ""
    const { questions, preferences: candidates } = questionsOf(
      { reply, ...asked },
      notes
    )
    if (Object.keys(questions).length === 0) {
      return {
        choices: {},
        multi: {},
        open: {},
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    }

    const state: EntryType = reply
      ? { reply: reply.text, records: context }
      : stateOf(context)
    const { answers, usage } = await client.systemOne(
      { state, questions },
      {
        signal,
        timeout: Math.max(1, deadline - Date.now()),
        retry: RETRY,
      }
    )

    const verdicts: JudgeOutput["choices"] = {}
    for (const [i, item] of asked.choices.entries()) {
      const verdict = verdictOf(answers[`c_${i}`], item.options.length)
      if (verdict) verdicts[item.key] = verdict
    }
    // A multi-select counts only when every one of its options was answered.
    const selected: JudgeOutput["multi"] = {}
    const addressed: Record<string, number> = {}
    for (const [i, item] of asked.multi.entries()) {
      const yes: number[] = []
      for (const k of item.options.keys()) {
        const answer = yesOf(answers[`m_${i}_${k}`])
        if (!answer) break
        yes.push(answer.noul)
      }
      if (yes.length === item.options.length) selected[item.key] = yes
      const answered = yesOf(answers[`a_${i}`])
      if (answered) addressed[item.key] = answered.noul
    }
    const written: JudgeOutput["open"] = {}
    for (const [i, item] of asked.open.entries()) {
      const answer = yesOf(answers[`o_${i}`])
      if (answer) written[item.key] = answer.noul
    }
    const sources: NonNullable<RecordJudgeOutput["sources"]> = {}
    if (asked.source === "records") {
      for (const [i, item] of [...asked.choices, ...asked.multi].entries()) {
        const answer = answers[`s_${i}`]
        const source = answer?.type === "choice" ? answer.choice : null
        if (source === "profile" || source === "resume")
          sources[item.key] = source
      }
    }
    return {
      choices: verdicts,
      multi: selected,
      ...(!reply && candidates.length > 0
        ? { preferences: preferredOptions(answers, candidates) }
        : {}),
      ...(reply ? { addressed } : {}),
      ...(asked.source === "records" ? { sources } : {}),
      open: written,
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      },
    }
  }
  const records = createRecordJudge(client, once)
  return (input) => (input.reply ? once(input) : records(input))
}
