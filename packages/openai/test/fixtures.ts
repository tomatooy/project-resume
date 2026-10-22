import type {
  Decision,
  DecisionRequest,
  OpenAIClientConfig,
} from "../src/index"

export type Fetch = NonNullable<OpenAIClientConfig["fetch"]>

export const request: DecisionRequest = {
  input: "Please refund a duplicate payment.",
  questions: [
    {
      type: "choice",
      name: "category",
      instructions: "Which team should handle the message?",
      choices: [
        { value: "billing", description: "Payments" },
        { value: "technical", description: "Product errors" },
      ],
    },
    {
      type: "score",
      name: "urgency",
      instructions: "How urgent is the request?",
      levels: [{ label: "Routine" }, { label: "Soon" }, { label: "Now" }],
    },
    {
      type: "predicate",
      name: "refundRequested",
      instructions: "Does the sender request a refund?",
    },
    {
      type: "predicate",
      name: "review",
      instructions: "Can the request be reviewed?",
    },
  ],
}

export const result: Decision = {
  model: "gpt-6-luna",
  answers: [
    {
      type: "choice",
      name: "category",
      choice: "billing",
      confidence: 0.9,
      probabilities: [
        { value: "billing", probability: 0.95 },
        { value: "technical", probability: 0.05 },
      ],
    },
    {
      type: "score",
      name: "urgency",
      score: 0.75,
      confidence: 0.7,
      probabilities: [
        { value: 0, label: "Routine", probability: 0.25 },
        { value: 1, label: "Soon", probability: 0.75 },
        { value: 2, label: "Now", probability: 0 },
      ],
    },
    { type: "predicate", name: "refundRequested", probability: 0.95 },
    { type: "refusal", name: "review" },
  ],
  usage: {
    input_tokens: 40,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens: 0,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 40,
  },
}
