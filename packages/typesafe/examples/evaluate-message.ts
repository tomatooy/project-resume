import { choice, noul, score, type TypeSafeClient } from "@workspace/typesafe"

/** The caller owns credentials, cancellation, and decisions based on the answers. */
export function evaluateMessage(
  client: TypeSafeClient,
  message: string,
  signal?: AbortSignal
) {
  return client.systemOne(
    {
      state: { message },
      questions: {
        category: choice("Which team should handle this message?", {
          billing: "Payments and invoices",
          technical: "Product errors and integrations",
          other: "Anything else",
        }),
        urgency: score("How urgent is the request?", [
          "No time constraint",
          "Time-sensitive but work can continue",
          "Work is blocked and immediate attention is requested",
        ]),
        refundRequested: noul("Does the sender explicitly request a refund?"),
      },
    },
    { signal }
  )
}
