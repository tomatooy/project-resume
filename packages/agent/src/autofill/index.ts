import type { AutofillModels } from "@workspace/resume-core"
import type { TypeSafeClient } from "@workspace/typesafe"

import type { Models } from "../models"
import { createJudge } from "./jev"
import { createAutofillText } from "./text"

export { createJudge } from "./jev"
export { createAutofillText } from "./text"

/**
 * The `AutofillModels` port. Either client may be missing: `ready()` says
 * which exist, and a call that needs a missing one rejects, so infer degrades
 * to rules and plain questions (spec 12.1).
 */
export function createAutofillModels(deps: {
  models: Models | null
  typesafe: TypeSafeClient | null
}): AutofillModels {
  const judge = deps.typesafe ? createJudge(deps.typesafe) : null
  const text = deps.models ? createAutofillText(deps.models) : null
  const need = <T>(client: T | null): T => {
    if (client === null) throw new Error("AI is not configured")
    return client
  }
  return {
    model: deps.models?.ids.fast ?? "unconfigured",
    ready: () => ({ judge: judge !== null, text: text !== null }),
    judge: async (input) => need(judge)(input),
    shortText: async (input) => need(text).shortText(input),
    questions: async (input) => need(text).questions(input),
    fillFromAnswer: async (input) => need(text).fillFromAnswer(input),
    mergeNotes: async (input) => need(text).mergeNotes(input),
    generate: async (input) => need(text).generate(input),
  }
}
