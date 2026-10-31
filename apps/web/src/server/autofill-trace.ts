import type { Json } from "@workspace/autofill"
import type { AutofillModels, ModelCall } from "@workspace/resume-core"
import type {
  Question as JevQuestion,
  TypeSafeClient,
} from "@workspace/typesafe"
import { createLogger, logAutofill } from "./log"

export async function traceAutofillRequest<TInput, TResult>(
  step: string,
  input: TInput,
  call: () => Promise<TResult>
): Promise<TResult> {
  const startedAt = performance.now()
  logAutofill(`${step} request`, input)
  const result = await call()
  logAutofill(
    `${step} result (${Math.round(performance.now() - startedAt)} ms)`,
    result
  )
  return result
}

async function traceModel<TInput extends ModelCall, TResult>(
  step: string,
  input: TInput,
  call: () => Promise<TResult>
): Promise<TResult> {
  const { signal: _signal, deadline: _deadline, ...request } = input
  const startedAt = performance.now()
  try {
    return await traceAutofillRequest(`model.${step}`, request, call)
  } catch (error) {
    // Capture before the service falls back to rules or questions.
    createLogger().error(
      "autofill_model_failed",
      { step, latencyMs: Math.round(performance.now() - startedAt) },
      error
    )
    throw error
  }
}

export function traceAutofillModels(models: AutofillModels): AutofillModels {
  return {
    get model() {
      return models.model
    },
    ready: () => models.ready(),
    judge: (input) => traceModel("judge", input, () => models.judge(input)),
    shortText: (input) =>
      traceModel("shortText", input, () => models.shortText(input)),
    questions: (input) =>
      traceModel("questions", input, () => models.questions(input)),
    fillFromAnswer: (input) =>
      traceModel("fillFromAnswer", input, () => models.fillFromAnswer(input)),
    mergeNotes: (input) =>
      traceModel("mergeNotes", input, () => models.mergeNotes(input)),
    generate: (input) =>
      traceModel("generate", input, () => models.generate(input)),
  }
}

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

/** Read labels without adding metadata to the model request. */
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

/** Preserve Jev probabilities before verdict conversion drops them. */
export function traceJevClient(client: TypeSafeClient): TypeSafeClient {
  return {
    systemOne: (request, options) => {
      const prefix = `jev [${jevStage(request)}] ${crypto.randomUUID()}`
      const startedAt = performance.now()
      logAutofill(`${prefix} request`, request)
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
        logAutofill(
          `${prefix} result (${Math.round(performance.now() - startedAt)} ms)`,
          { ...response, answers }
        )
        return response
      })
    },
  }
}
