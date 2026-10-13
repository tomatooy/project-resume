import type { Concept, FieldSnapshot } from "./contract"
export const normalize = (value: string): string =>
  value
    .toLocaleLowerCase("en-US")
    .replace(/[_*:?.,()/–-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
const labels: Partial<Record<Concept, string[]>> = {
  display_name: ["full name", "your name", "name"],
  contact_email: ["email", "email address", "your email", "e mail"],
  contact_phone: ["phone", "phone number", "telephone", "mobile phone"],
  summary: ["professional summary"],
  legal_given_name: ["first name", "given name", "legal first name"],
  legal_middle_name: ["middle name", "legal middle name"],
  legal_family_name: ["last name", "family name", "surname", "legal last name"],
  preferred_name: ["preferred name"],
  linkedin_url: ["linkedin", "linkedin profile", "linkedin url"],
  github_url: ["github", "github url"],
  portfolio_url: ["portfolio", "portfolio url"],
  website_url: ["website", "personal website"],
  country: ["country", "country of residence"],
  address_line1: ["street address", "address line 1"],
  address_line2: ["address line 2", "apartment suite"],
  city: ["city", "town"],
  administrative_area: ["state", "province", "state province"],
  postal_code: ["zip code", "postal code", "zip postal code"],
  current_employer: ["current employer"],
  recent_employer: ["most recent employer"],
  experience_company: ["company", "company name", "employer"],
  experience_role: ["job title", "position", "role"],
  education_school: [
    "school",
    "university",
    "university college",
    "institution",
  ],
  education_degree: ["degree"],
  education_field: ["field of study", "major"],
  work_authorized: [
    "are you legally authorized to work in the united states",
    "are you authorized to work in the united states",
  ],
  sponsorship_now: [
    "do you currently require sponsorship to work in the united states",
  ],
  sponsorship_future: [
    "will you require sponsorship in the future to work in the united states",
  ],
  sponsorship_now_or_future: [
    "will you now or in the future require visa sponsorship to work in the united states",
    "will you now or in the future require sponsorship to work in the united states",
  ],
  available_from: ["available start date", "earliest start date"],
  relocation: ["are you willing to relocate"],
  eeo_gender: ["gender identity"],
  eeo_race_ethnicity: [
    "race ethnicity",
    "Race / ethnicity (US application categories)",
  ],
  eeo_disability: ["do you have or have you previously had a disability"],
  eeo_veteran: ["have you served in the us military"],
  eeo_protected_veteran: [
    "protected veteran status",
    "Are you a disabled veteran, recently separated veteran, active duty wartime or campaign badge veteran, or Armed Forces service medal veteran?",
  ],
}
export function ruleFor(
  field: FieldSnapshot
): { concept: Concept; ruleId: string } | null {
  const context = normalize(`${field.section} ${field.description}`)
  if (
    /reference|referee|emergency contact|recommendation|previous address|citizenship|nationality/.test(
      context
    )
  )
    return null
  const name = normalize(field.label)
  if (
    name === "name" &&
    !/contact|personal|applicant|your details/.test(context)
  )
    return null
  if (name === "start date" || name === "end date") {
    const kind = /education/.test(context)
      ? "education"
      : /employment|experience|work history/.test(context)
        ? "experience"
        : null
    if (kind)
      return {
        concept:
          kind === "education"
            ? name === "start date"
              ? "education_start"
              : "education_end"
            : name === "start date"
              ? "experience_start"
              : "experience_end",
        ruleId: `label:${kind}:${name}`,
      }
  }
  for (const [concept, values] of Object.entries(labels)) {
    if (!values.some((v) => normalize(v) === name)) continue
    const parsed = conceptFrom(concept)
    if (parsed) return { concept: parsed, ruleId: `label:${parsed}` }
  }
  return null
}
import { ConceptSchema } from "./contract"
function conceptFrom(value: string): Concept | null {
  const result = ConceptSchema.safeParse(value)
  return result.success ? result.data : null
}
export function blockedField(field: FieldSnapshot): string | null {
  const choices = ["checkbox_group", "radio_group"].includes(field.control)
    ? field.options?.options.map((o) => `${o.label} ${o.description}`).join(" ")
    : ""
  const text = normalize(
    `${field.label} ${field.description} ${field.section} ${choices ?? ""}`
  )
  if (
    /agree|consent|certif|acknowledge|terms|privacy policy|subscribe|signature|referee|reference|emergency contact|password|captcha|credit card|payment|login|sign in|social security/.test(
      text
    )
  )
    return "manual_only"
  if (
    /cover letter|why (?:do|are|would)|tell us|describe (?:a|your)|motivation/.test(
      text
    )
  )
    return "needs_draft"
  return null
}
