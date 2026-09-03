import { nodeScope } from "../scope"
import { defineSkill } from "./define"

export const grammarClarity = defineSkill({
  id: "grammar_clarity",
  name: "Grammar and clarity",
  description: "Fix grammar, tense and hedging language.",
  scope: nodeScope,
  fragment: () =>
    [
      "Fix grammar, spelling, punctuation and tense: past tense for past roles, present tense for the current one. Remove hedging such as 'helped', 'assisted with', 'various' and 'responsible for' when a direct verb says the same thing.",
      "Make the smallest edit that fixes the problem. Do not restyle, reorder or add content, and do not touch text that is already correct.",
    ].join("\n"),
})
