import {
  applicantEvidence,
  type ApplicantEvidence,
  type ApplicantSource,
  evidenceContext,
  type Json,
  jsonObject,
  notesOf,
  relevantEvidence,
} from "@workspace/autofill"
import {
  type AutofillModels,
  CHOICE_MIN,
  type JudgeInput,
  type JudgeOutput,
  type ModelUsage,
  MULTI_YES,
} from "@workspace/resume-core"
import { noul, type Question, type TypeSafeClient } from "@workspace/typesafe"

import { dataBlock, JEV_DATA_RULE } from "../prompts/autofill"
import { beforeDeadline } from "./deadline"
import type { RecordJudgeInput, RecordJudgeOutput } from "./jev"

type Verdict = JudgeOutput["choices"][string]
/** One call's answer to a field, and the source it came from when known. */
type Reading<T> = { value: T; source: ApplicantSource | null }

/** Source priority: Profile, then Notes, then the resume. */
const SOURCES: ApplicantSource[] = ["profile", "notes", "resume"]
/** A records answer whose source Jev did not name ranks last. */
const rank = (source: ApplicantSource | null): number =>
  source === null ? SOURCES.length : SOURCES.indexOf(source)

const empty = (): JudgeOutput => ({
  choices: {},
  multi: {},
  open: {},
  usage: { inputTokens: 0, outputTokens: 0 },
})
const missing = (blocked = false): Verdict => ({
  option: null,
  applicant: false,
  confidence: 0,
  blocked,
})

function addUsage(total: ModelUsage, usage: ModelUsage): void {
  total.inputTokens += usage.inputTokens
  total.outputTokens += usage.outputTokens
}

/**
 * The first of the ranked answers, so the higher-priority source wins when
 * the calls disagree. "conflict" when an answer that disagrees has no source
 * to rank it by; undefined when there is no answer.
 */
function winner<T>(
  answers: Reading<T>[],
  same: (a: T, b: T) => boolean
): Reading<T> | "conflict" | undefined {
  const [first, ...rest] = answers
  if (!first) return undefined
  const unranked = rest.some(
    (other) => other.source === null && !same(first.value, other.value)
  )
  return unranked ? "conflict" : first
}

const sameChoice = (a: Verdict, b: Verdict): boolean =>
  a.option === b.option && a.applicant === b.applicant

/** The options a multi-select answer selects, as a comparable key. */
const selection = (yes: number[]): string =>
  yes.map((p) => (p >= MULTI_YES ? 1 : 0)).join("")

/**
 * Notes and Profile/resume calls in parallel, then one evidence check for a
 * weak pick. A passing answer from either call is used: a choice at
 * CHOICE_MIN or above, or a multi-select with an option at MULTI_YES or
 * above. A weak choice counts only when neither call passes, and then must
 * pass verification. When the calls disagree, Profile beats Notes and Notes
 * beat the resume; a records answer without a named source cannot be
 * ranked, so the field is asked. A failed call gives no answer.
 */
export function createRecordJudge(
  client: TypeSafeClient,
  once: (input: RecordJudgeInput) => Promise<RecordJudgeOutput>
): AutofillModels["judge"] {
  return async (input) => {
    const { context, choices, multi, open } = input
    const records = jsonObject(context)
    const facts = applicantEvidence(context)
    const notes = notesOf(context)
    const hasRecords = facts.profile.length + facts.resume.length > 0
    const call = (request: RecordJudgeInput, needed: boolean) =>
      needed
        ? beforeDeadline(
            {
              signal: input.signal,
              deadline:
                input.deadline -
                Math.min(1_500, Math.max(0, input.deadline - Date.now()) / 3),
            },
            (call) => once({ ...request, ...call })
          )
        : Promise.resolve<RecordJudgeOutput>(empty())
    const [noted, recorded] = await Promise.allSettled([
      call(
        { ...input, context: { notes }, open: [], source: "notes" },
        Boolean(notes.trim()) && choices.length + multi.length > 0
      ),
      call(
        {
          ...input,
          context: {
            today: records.today ?? "",
            profile: records.profile ?? {},
            resume: records.resume ?? null,
          },
          choices: hasRecords ? choices : [],
          multi: hasRecords ? multi : [],
          open,
          source: "records",
        },
        (hasRecords && choices.length + multi.length > 0) || open.length > 0
      ),
    ])
    const noteOutput = noted.status === "fulfilled" ? noted.value : null
    const recordOutput = recorded.status === "fulfilled" ? recorded.value : null
    /** Each call's reading of a field, highest priority first. */
    const readingsOf = <T>(
      key: string,
      read: (judged: JudgeOutput) => T | undefined
    ): Reading<T>[] => {
      const named = recordOutput?.sources?.[key] ?? null
      return [
        { judged: noteOutput, source: "notes" as const },
        {
          judged: recordOutput,
          // A source with no facts cannot hold the evidence.
          source: named && facts[named].length > 0 ? named : null,
        },
      ]
        .flatMap(({ judged, source }) => {
          const value = judged ? read(judged) : undefined
          return value === undefined ? [] : [{ value, source }]
        })
        .sort((a, b) => rank(a.source) - rank(b.source))
    }
    const output = empty()
    output.degraded = noteOutput === null || recordOutput === null
    for (const result of [noteOutput, recordOutput])
      if (result) addUsage(output.usage, result.usage)
    output.open = recordOutput?.open ?? {}
    output.preferences = {}
    const unanswered: string[] = []
    for (const item of choices) {
      const readings = readingsOf(
        item.key,
        (judged) => judged.choices[item.key]
      )
      const answers = readings.filter(
        ({ value }) => value.option !== null || value.applicant
      )
      const passing = answers.filter(
        ({ value }) => value.confidence >= CHOICE_MIN
      )
      const chosen = winner(passing.length > 0 ? passing : answers, sameChoice)
      if (chosen === "conflict") output.choices[item.key] = missing(true)
      else if (chosen?.source)
        output.choices[item.key] = {
          ...chosen.value,
          source: chosen.source,
          evidence: facts[chosen.source].map(({ ref }) => ref),
        }
      else if (chosen) output.choices[item.key] = chosen.value
      else {
        // No answer: the top reading keeps its scores for the how-heard guess.
        output.choices[item.key] = readings[0]?.value ?? missing()
        unanswered.push(item.key)
      }
    }
    for (const item of multi) {
      const readings = readingsOf(item.key, (judged) => judged.multi[item.key])
      const chosen = winner(
        readings.filter(({ value }) => value.some((p) => p >= MULTI_YES)),
        (a, b) => selection(a) === selection(b)
      )
      if (chosen === "conflict") output.multi[item.key] = []
      else if (chosen) output.multi[item.key] = chosen.value
      else {
        const top = readings[0]
        if (top) output.multi[item.key] = top.value
        unanswered.push(item.key)
      }
    }
    // A Notes fallback order fills only a field neither call answers.
    for (const key of unanswered) {
      const preference = noteOutput?.preferences?.[key]
      if (preference) output.preferences[key] = preference
    }
    await verify(client, input, facts, output)
    return output
  }
}

async function verify(
  client: TypeSafeClient,
  input: JudgeInput,
  facts: Record<ApplicantSource, ApplicantEvidence[]>,
  output: JudgeOutput
): Promise<void> {
  const candidates = input.choices.flatMap((item) => {
    const verdict = output.choices[item.key]
    const source = verdict?.source
    const option = verdict?.option
    if (
      !verdict ||
      !source ||
      option === null ||
      option === undefined ||
      verdict.applicant ||
      verdict.blocked ||
      verdict.confidence >= CHOICE_MIN
    )
      return []
    const value = item.options[option]
    if (value === undefined) return []
    return [{ item, verdict, source, value }]
  })
  if (
    !candidates.length ||
    input.signal.aborted ||
    Date.now() >= input.deadline
  )
    return
  const questions: Record<string, Question> = {}
  const evidence: Record<string, Json> = {}
  for (const [i, { item, source, value }] of candidates.entries()) {
    evidence[`v_${i}`] = evidenceContext(
      source,
      relevantEvidence(facts[source], item)
    )
    const data = [
      `Field: ${dataBlock(item.label)}`,
      ...(item.help ? [`Help: ${dataBlock(item.help)}`] : []),
      `Available options: ${item.options.map(dataBlock).join(" / ")}`,
      `Proposed answer: ${dataBlock(value)}`,
      `Use only state.evidence.v_${i} as applicant evidence for this check.`,
      JEV_DATA_RULE,
    ].join("\n")
    questions[`support_${i}`] = noul(
      [
        "Does the evidence support the proposed answer to this field, including its help text? Match equivalent wording and respect all qualifiers. Missing evidence is not support.",
        data,
      ].join("\n")
    )
    questions[`contradiction_${i}`] = noul(
      [
        "Does this evidence contain an explicit fact or preference that contradicts the proposed answer for the same field and scope? Another acceptable preference is not a contradiction. Missing information is not a contradiction.",
        data,
      ].join("\n")
    )
  }
  try {
    const result = await beforeDeadline(
      { signal: input.signal, deadline: input.deadline - 50 },
      (call) =>
        client.systemOne(
          { state: { evidence }, questions },
          {
            signal: call.signal,
            timeout: Math.max(1, call.deadline - Date.now()),
            retry: { maxRetries: 0 },
          }
        )
    )
    addUsage(output.usage, {
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
    })
    for (const [i, candidate] of candidates.entries()) {
      const support = result.answers[`support_${i}`]
      const contradiction = result.answers[`contradiction_${i}`]
      if (support?.type === "noul" && contradiction?.type === "noul") {
        candidate.verdict.verification = {
          support: support.noul,
          contradiction: contradiction.noul,
        }
      }
    }
  } catch {
    output.degraded = true
  }
}
