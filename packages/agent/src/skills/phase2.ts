import { wholeDocument } from "../scope"
import { defineSkill } from "./define"

/**
 * Registered so their ids, ops and inputs are stable for the picker and the
 * database, but the route refuses them until they have real prompts.
 */
const NOT_YET = () => "This skill is not available yet."

export const atsKeyword = defineSkill({
  id: "ats_keyword",
  name: "Keyword coverage",
  description: "Surface terms the posting uses that the resume does not.",
  scope: wholeDocument,
  fragment: NOT_YET,
})

export const impactQuantification = defineSkill({
  id: "impact_quantification",
  name: "Add metrics",
  description: "Ask for the numbers a bullet is missing.",
  scope: wholeDocument,
  fragment: NOT_YET,
})

export const summaryOptimize = defineSkill({
  id: "summary_optimize",
  name: "Sharpen summary",
  description: "Rework the summary against the target role.",
  scope: wholeDocument,
  fragment: NOT_YET,
})
