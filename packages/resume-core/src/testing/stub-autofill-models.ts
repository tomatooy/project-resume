import type { AutofillModels, ModelUsage } from "../ports/autofill-models"

const usage = (): ModelUsage => ({ inputTokens: 10, outputTokens: 5 })

/**
 * Models that answer nothing. A test overrides the methods it cares about,
 * wrapped in `vi.fn` when it reads what the service sent.
 */
export function stubAutofillModels(
  over: Partial<AutofillModels> = {}
): AutofillModels {
  return {
    model: "stub-model",
    ready: () => ({ judge: true, text: true }),
    judge: async () => ({ choices: {}, multi: {}, open: {}, usage: usage() }),
    shortText: async () => ({ answers: [], usage: usage() }),
    questions: async () => ({ questions: [], usage: usage() }),
    fillFromAnswer: async () => ({ answers: [], usage: usage() }),
    mergeNotes: async () => ({
      proposal: { ops: [], hints: [] },
      usage: usage(),
    }),
    generate: async () => ({ text: "", usage: usage() }),
    ...over,
  }
}
