import { defineSkill } from "./define"

export const bulletRewrite = defineSkill({
  id: "bullet_rewrite",
  fragment: () =>
    [
      "Rewrite the bullets in scope. Each one leads with an action verb, says what the person did, and lands on a result, with scale where the resume already gives it.",
      'Never open with "Responsible for", "Helped with", "Worked on", "Assisted with", "Duties included" or "Tasked with". Say what they actually did: led, built, shipped, cut, grew, automated, migrated, owned.',
      "Keep every fact and figure the original states, and add none. Do not estimate or approximate a number into existence; that patch is refused and the turn is wasted.",
      'A bullet with no figure still gets rewritten. Fix the verb and the outcome now, then add one `gaps` entry naming the specific number that would make it land ("team size on the migration bullet", "deploy frequency before and after"). If the proposal has any gaps, set `followUpQuestion` to ask for the single most valuable one.',
      "One line per bullet, under about 25 words.",
      "One replace_text patch per bullet, on its text field. Leave a bullet alone when it is already tight; fewer, better patches beat a patch for everything. When the user selected a single bullet, rewrite only that one unless they ask for more.",
      [
        "Shape only. The placeholders below are illustration; never copy them into a patch unless the user asked for placeholders.",
        "  Weak:   Responsible for managing the deployment pipeline.",
        "  Strong: Owned the deployment pipeline, cutting release time from <before> to <after>.",
        "  Weak:   Helped with onboarding new engineers.",
        "  Strong: Built the engineer onboarding track, ramping <N> hires to first commit in <days>.",
      ].join("\n"),
    ].join("\n\n"),
})
