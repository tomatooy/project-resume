import type { APIPromise, Decision, OpenAIClient } from "@workspace/openai"

export function evaluateMessage(
  client: OpenAIClient,
  message: string,
  signal?: AbortSignal
): APIPromise<Decision> {
  return client.decisions.create(
    {
      input: message,
      questions: [
        {
          type: "choice",
          name: "category",
          instructions: "Which team should handle this message?",
          choices: [
            { value: "billing", description: "Payments and invoices" },
            { value: "technical", description: "Product errors" },
            { value: "other", description: "Anything else" },
          ],
        },
        {
          type: "score",
          name: "urgency",
          instructions: "How urgent is the request?",
          levels: [
            { label: "Routine", description: "No time constraint" },
            { label: "Soon", description: "Time-sensitive; work can continue" },
            { label: "Now", description: "Work is blocked" },
          ],
        },
        {
          type: "predicate",
          name: "refundRequested",
          instructions: "Does the sender explicitly request a refund?",
        },
      ],
    },
    { signal }
  )
}
