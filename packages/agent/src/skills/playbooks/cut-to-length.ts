/**
 * Cutting to length: what to remove before removing facts.
 *
 * There is no page target to read: the count comes from `check_fit` when the
 * user asks about length, and this playbook is the priority order for a cut.
 */
export const cutToLength = [
  "Shorten wordy bullets, merge overlapping ones, delete the weakest, and move lower-value items later. Keep the strongest evidence for the user's headline and the most recent role.",
  "Cut wording before cutting facts: remove throat-clearing, repeated context, and qualifiers first. Delete a whole bullet or item only when nothing in it is load-bearing for the target role.",
  "Call `check_fit` with the candidate patches to learn the page count they produce. If it is still too long, cut further and check again. Then call `propose_patches` with the final list.",
].join("\n\n")
