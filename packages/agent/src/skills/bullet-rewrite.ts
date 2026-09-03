import { nodeScope } from "../scope"
import { defineSkill } from "./define"

export const bulletRewrite = defineSkill({
  id: "bullet_rewrite",
  name: "Rewrite bullets",
  description: "Tighten wording without changing the facts.",
  allowedFields: { bullet: ["text"] },
  scope: nodeScope,
  fragment: () =>
    [
      "Rewrite the bullets in scope so each one leads with a strong verb and a concrete outcome, keeps every fact and figure the original states, and stays under about 25 words.",
      "One replace_text patch per bullet, on its text field. Leave a bullet alone when it is already tight; fewer, better patches beat a patch for everything.",
      "When the user selected a single bullet, rewrite only that one unless they ask for more.",
    ].join("\n"),
})
