/**
 * Impact bullets: how a bullet earns its line.
 *
 * The patch mechanics are not here. The static contract says which op writes a
 * bullet and how `before` must match; this says what a good bullet reads like.
 */
export const impactBullets = [
  "Rewrite the bullets in scope so each one leads with an action verb, says what the person did, and lands on a result, using the scale the resume already gives.",
  'Never open with "Responsible for", "Helped with", "Worked on", "Assisted with", "Duties included" or "Tasked with". Say what they actually did: led, built, shipped, cut, grew, automated, migrated, owned.',
  "Keep every fact and figure the original states, and never trade a stated figure for a vaguer sentence. A figure the bullet is missing is the quantifier playbook's job.",
  'When the work has a size the bullet never states, load `resume_quantifier` and add one there. Put the one figure only the user can confirm in `gaps`, and ask for it with `followUpQuestion` ("team size on the migration bullet", "deploy frequency before and after").',
  "One line per bullet, under about 25 words.",
  "Leave a bullet alone when it is already tight. Fewer, better patches beat a patch for everything. When the user selected a single bullet, rewrite only that one unless they ask for more.",
  [
    "Shape only. The placeholders below are illustration; never copy them into a patch unless the user asked for placeholders.",
    "  Weak:   Responsible for managing the deployment pipeline.",
    "  Strong: Owned the deployment pipeline, cutting release time from <before> to <after>.",
    "  Weak:   Helped with onboarding new engineers.",
    "  Strong: Built the engineer onboarding track, ramping <N> hires to first commit in <days>.",
  ].join("\n"),
].join("\n\n")
