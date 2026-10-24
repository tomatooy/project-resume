import {
  applicantEvidence,
  type ApplicantEvidence,
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
import type { SourceJudgeInput } from "./jev"

type Verdict = JudgeOutput["choices"][string]
type Source = NonNullable<SourceJudgeInput["source"]>
type Reading<T> = { value: T; source: Source }

const empty = (): JudgeOutput => ({
  choices: {},
  multi: {},
  open: {},
  usage: { inputTokens: 0, outputTokens: 0 },
})
const missing = (): Verdict => ({
  option: null,
  applicant: false,
  confidence: 0,
  blocked: false,
})

function addUsage(total: ModelUsage, usage: ModelUsage): void {
  total.inputTokens += usage.inputTokens
  total.outputTokens += usage.outputTokens
}

/**
 * Notes and Profile calls in parallel. Profile wins among passing answers;
 * weak choices need evidence verification. A failed call gives no answer.
 */
export function createRecordJudge(
  client: TypeSafeClient,
  once: (input: SourceJudgeInput) => Promise<JudgeOutput>
): AutofillModels["judge"] {
  return async (input) => {
    const { context, choices, multi, open } = input
    const records = jsonObject(context)
    const { profile, notes: noteFacts } = applicantEvidence(context)
    const facts = { profile, notes: noteFacts }
    const notes = notesOf(context)
    const hasProfile = profile.length > 0
    const call = (request: SourceJudgeInput, needed: boolean) =>
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
        : Promise.resolve<JudgeOutput>(empty())
    const [noted, profiled] = await Promise.allSettled([
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
          },
          choices: hasProfile ? choices : [],
          multi: hasProfile ? multi : [],
          open,
          source: "profile",
        },
        (hasProfile && choices.length + multi.length > 0) || open.length > 0
      ),
    ])
    const noteOutput = noted.status === "fulfilled" ? noted.value : null
    const profileOutput =
      profiled.status === "fulfilled" ? profiled.value : null
    /** Each call's reading of a field, highest priority first. */
    const readingsOf = <T>(
      read: (judged: JudgeOutput) => T | undefined
    ): Reading<T>[] => {
      const readings: { judged: JudgeOutput | null; source: Source }[] = [
        { judged: profileOutput, source: "profile" },
        { judged: noteOutput, source: "notes" },
      ]
      return readings.flatMap(({ judged, source }) => {
        const value = judged ? read(judged) : undefined
        return value === undefined ? [] : [{ value, source }]
      })
    }
    const output = empty()
    output.degraded = noteOutput === null || profileOutput === null
    for (const result of [noteOutput, profileOutput])
      if (result) addUsage(output.usage, result.usage)
    output.open = profileOutput?.open ?? {}
    output.preferences = {}
    const unanswered: string[] = []
    for (const item of choices) {
      const readings = readingsOf((judged) => judged.choices[item.key])
      const answers = readings.filter(
        ({ value }) => value.option !== null || value.applicant
      )
      const passing = answers.filter(
        ({ value }) => value.confidence > CHOICE_MIN
      )
      const chosen = passing[0] ?? answers[0]
      if (chosen)
        output.choices[item.key] = {
          ...chosen.value,
          source: chosen.source,
          evidence: facts[chosen.source].map(({ ref }) => ref),
        }
      else {
        // No answer: the top reading keeps its scores for the how-heard guess.
        output.choices[item.key] = readings[0]?.value ?? missing()
        unanswered.push(item.key)
      }
    }
    for (const item of multi) {
      const readings = readingsOf((judged) => judged.multi[item.key])
      const chosen = readings.find(({ value }) =>
        value.some((p) => p >= MULTI_YES)
      )
      if (chosen) output.multi[item.key] = chosen.value
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
  facts: Record<Source, ApplicantEvidence[]>,
  output: JudgeOutput
): Promise<void> {
  const candidates = input.choices.flatMap((item) => {
    const verdict = output.choices[item.key]
    const source = verdict?.source
    const option = verdict?.option
    if (
      !verdict ||
      (source !== "profile" && source !== "notes") ||
      option === null ||
      option === undefined ||
      verdict.applicant ||
      verdict.blocked ||
      verdict.confidence > CHOICE_MIN
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
