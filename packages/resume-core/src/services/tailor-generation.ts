import {
  assembleResume,
  regenerateIds,
  ResumeSchema,
  type ParsedResume,
  type Resume,
} from "@workspace/resume-schema"
import type { ParsedJobPosting } from "../domain/job-target"
import { enforceTailorRules } from "../domain/tailor"

export function finishTailoredDocument(
  source: Resume,
  parsed: ParsedResume
): Resume {
  return ResumeSchema.parse(
    regenerateIds(enforceTailorRules(source, assembleResume(parsed)))
  )
}
export function tailorNames(posting: ParsedJobPosting, fallback: string) {
  const company = posting.company.trim()
  const role = posting.title.trim()
  return {
    title:
      company && role
        ? `${company} - ${role}`
        : company || role || `${fallback} copy`,
    subtitle: company ? `Tailored for ${company}` : "Tailored for this role",
    label: company
      ? `Tailored for ${role || "this role"} at ${company}`
      : `Tailored for ${role || "this role"}`,
  }
}
