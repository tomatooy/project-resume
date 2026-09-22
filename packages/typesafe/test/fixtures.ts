import { choice, noul, score, type SystemOneResult } from "../src/index"

export const questions = {
  category: choice("Which team should handle the message?", {
    billing: "Payments",
    technical: "Product errors",
    other: "Anything else",
  }),
  urgency: score("How urgent is the request?", ["Routine", "Soon", "Now"]),
  refundRequested: noul("Does the sender request a refund?"),
}

export const request = {
  state: { message: "Please refund a duplicate payment." },
  questions,
}

export const result: SystemOneResult<typeof questions> = {
  model: "jev-test",
  answers: {
    category: {
      type: "choice",
      choice: "billing",
      confidence: 0.9,
      probabilities: { billing: 0.9, technical: 0.05, other: 0.05 },
    },
    urgency: {
      type: "score",
      score: 0.75,
      confidence: 0.7,
      legend: { 0: "Routine", 1: "Soon", 2: "Now" },
      probabilities: { 0: 0.25, 1: 0.75, 2: 0 },
    },
    refundRequested: { type: "noul", noul: 0.95 },
  },
  usage: { input_tokens: 40, output_tokens: 12 },
}
