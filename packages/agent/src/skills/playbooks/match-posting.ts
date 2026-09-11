/**
 * Matching a posting: the honest version of keyword coverage.
 *
 * The job description itself arrives in its own block, not in the playbook, so
 * a body can be static and cached. What is here is the judgement: which words
 * to prefer, and what never to claim.
 */
export const matchPosting = [
  "The user is applying for the role in the job description. Reword bullets and the summary to use the posting's terminology where the resume genuinely supports it, move the most relevant items and bullets first, and drop bullets that add nothing for this role.",
  'Mirror the posting\'s own words for what the resume already does: if it says "observability" and the resume says "monitoring", prefer the posting\'s term when both are honest. Do not force a term into a sentence it does not fit.',
  "Never claim a skill, tool or result the resume does not already show. A qualification the posting asks for that the resume lacks goes in `gaps`, one short line each, so the user decides whether to add it.",
  "Keep the strongest evidence for the user's headline and the most recent role. Reordering is a real improvement when the most relevant material is buried; do it for that reason, not to reshuffle.",
].join("\n\n")
