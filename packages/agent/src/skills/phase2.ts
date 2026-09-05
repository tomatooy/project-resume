import { defineSkill } from "./define"

/**
 * Registered as `phase2` so their ids, ops and inputs are stable for the
 * picker and the database, but the route refuses them until they have real
 * prompts.
 */
const NOT_YET = () => "This skill is not available yet."

export const atsKeyword = defineSkill({
  id: "ats_keyword",
  fragment: NOT_YET,
})

export const impactQuantification = defineSkill({
  id: "impact_quantification",
  fragment: NOT_YET,
})

export const summaryOptimize = defineSkill({
  id: "summary_optimize",
  fragment: NOT_YET,
})
