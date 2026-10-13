import { countryName } from "../autofill-profile/countries"
import type { Resume } from "@workspace/resume-schema"
import type { AutofillProfile } from "../autofill-profile/schema"
import type { EEO_DEFINITIONS } from "../autofill-profile/schema"
import type {
  Concept,
  PlanInput,
  SourceStamp,
  Fact,
  SupplementalRecord,
} from "./contract"
import { meaningfulAnswer } from "./answers"
import { normalize } from "./rules"

export type { Fact } from "./contract"
export function factsFor(
  resume: Resume,
  profile: AutofillProfile,
  stamp: SourceStamp,
  overrides: PlanInput["overrides"] = [],
  supplementalRecords: SupplementalRecord[] = []
): Fact[] {
  const facts: Fact[] = []
  function add(
    concept: Concept,
    value: string | undefined,
    source: "resume" | "profile",
    key: string,
    sourceLabel: string,
    recordId?: string,
    countryCode?: string,
    aliases: string[] = [],
    applicationId?: string
  ) {
    if (!value || !meaningfulAnswer(value) || value === "present") return
    facts.push({
      factId: `${concept}:${recordId ?? countryCode ?? "single"}`,
      concept,
      value,
      recordId,
      countryCode,
      ...(concept === "salary"
        ? {
            conditions: {
              currency: profile.data.preferences.salaryCurrency || undefined,
              salaryPeriod:
                profile.data.preferences.salaryPeriod === "unknown"
                  ? undefined
                  : profile.data.preferences.salaryPeriod,
            },
          }
        : {}),
      aliases,
      sensitive:
        /^(eeo_|work_authorized|sponsorship_|salary|available_from|relocation)/.test(
          concept
        ),
      sourceLabel,
      sourceRef: applicationId
        ? { kind: "application_record", key, recordId, applicationId }
        : source === "profile"
          ? {
              kind: "autofill_profile",
              key,
              recordId,
              revision: profile.revision,
            }
          : stamp.resumeSource.kind === "head"
            ? {
                kind: "resume_head",
                key,
                recordId,
                resumeId: stamp.resumeId,
                revision: stamp.resumeSource.revision,
                contentHash: stamp.resumeSource.contentHash,
              }
            : {
                kind: "resume_version",
                key,
                recordId,
                resumeId: stamp.resumeId,
                versionId: stamp.resumeSource.versionId,
                contentHash: stamp.resumeSource.contentHash,
              },
    })
  }
  add(
    "display_name",
    resume.basics.name,
    "resume",
    "basics.name",
    "Resume: display name"
  )
  add(
    "contact_email",
    resume.basics.email,
    "resume",
    "basics.email",
    "Resume: email"
  )
  add(
    "contact_phone",
    resume.basics.phone,
    "resume",
    "basics.phone",
    "Resume: phone"
  )
  add(
    "summary",
    resume.basics.summary,
    "resume",
    "basics.summary",
    "Resume: summary"
  )
  const p = profile.data
  const simple: [Concept, string, string][] = [
    ["display_name", p.identity.displayName ?? "", "identity.displayName"],
    ["contact_email", p.identity.email ?? "", "identity.email"],
    ["contact_phone", p.identity.phone ?? "", "identity.phone"],
    ["legal_given_name", p.identity.legalGivenName, "identity.legalGivenName"],
    [
      "legal_middle_name",
      p.identity.legalMiddleName,
      "identity.legalMiddleName",
    ],
    [
      "legal_family_name",
      p.identity.legalFamilyName,
      "identity.legalFamilyName",
    ],
    ["preferred_name", p.identity.preferredName, "identity.preferredName"],
    ["linkedin_url", p.links.linkedinUrl, "links.linkedinUrl"],
    ["github_url", p.links.githubUrl, "links.githubUrl"],
    ["portfolio_url", p.links.portfolioUrl, "links.portfolioUrl"],
    ["website_url", p.links.websiteUrl, "links.websiteUrl"],
    ["country", p.address.countryCode, "address.countryCode"],
    ["address_line1", p.address.addressLine1, "address.addressLine1"],
    ["address_line2", p.address.addressLine2, "address.addressLine2"],
    ["city", p.address.city, "address.city"],
    [
      "administrative_area",
      p.address.administrativeArea,
      "address.administrativeArea",
    ],
    ["postal_code", p.address.postalCode, "address.postalCode"],
  ]
  for (const [concept, value, key] of simple)
    add(
      concept,
      value,
      "profile",
      key,
      `Autofill Profile: ${concept.replaceAll("_", " ")}`,
      undefined,
      undefined,
      concept === "country" && value ? [countryName(value)] : []
    )
  for (const link of resume.basics.links) {
    const url = new URL(link.url)
    const host = url.hostname.replace(/^www\./, "").toLowerCase()
    const label = normalize(link.label)
    const concept =
      host === "linkedin.com" && /^\/in\//.test(url.pathname)
        ? "linkedin_url"
        : host === "github.com"
          ? "github_url"
          : label === "portfolio"
            ? "portfolio_url"
            : ["website", "personal website"].includes(label)
              ? "website_url"
              : null
    if (
      concept &&
      !facts.some((fact) => fact.concept === concept && fact.value === link.url)
    )
      add(
        concept,
        link.url,
        "resume",
        `basics.links.${link.id}`,
        `Resume: ${link.label}`
      )
  }
  for (const row of p.workAuthorization) {
    add(
      "work_authorized",
      row.authorizedToWork,
      "profile",
      "workAuthorization.authorizedToWork",
      `Profile: work authorization (${row.countryCode})`,
      undefined,
      row.countryCode
    )
    add(
      "sponsorship_now",
      row.requiresSponsorshipNow,
      "profile",
      "workAuthorization.requiresSponsorshipNow",
      `Profile: sponsorship now (${row.countryCode})`,
      undefined,
      row.countryCode
    )
    add(
      "sponsorship_future",
      row.requiresSponsorshipFuture,
      "profile",
      "workAuthorization.requiresSponsorshipFuture",
      `Profile: future sponsorship (${row.countryCode})`,
      undefined,
      row.countryCode
    )
    const sponsorship = [
      row.requiresSponsorshipNow,
      row.requiresSponsorshipFuture,
    ]
    add(
      "sponsorship_now_or_future",
      sponsorship.includes("yes")
        ? "yes"
        : sponsorship.every((answer) => answer === "no")
          ? "no"
          : "unknown",
      "profile",
      "workAuthorization",
      `Profile: sponsorship now or in the future (${row.countryCode})`,
      undefined,
      row.countryCode
    )
  }
  add(
    "available_from",
    p.preferences.availableFrom,
    "profile",
    "preferences.availableFrom",
    "Profile: start date",
    undefined,
    p.preferences.countryCode || undefined
  )
  add(
    "relocation",
    p.preferences.willingToRelocate,
    "profile",
    "preferences.willingToRelocate",
    "Profile: relocation",
    undefined,
    p.preferences.countryCode || undefined
  )
  if (
    p.preferences.salaryAmount !== null &&
    p.preferences.salaryCurrency &&
    p.preferences.salaryPeriod !== "unknown"
  )
    add(
      "salary",
      `${p.preferences.salaryAmount} ${p.preferences.salaryCurrency} / ${p.preferences.salaryPeriod}`,
      "profile",
      "preferences.salary",
      "Profile: salary",
      undefined,
      p.preferences.countryCode || undefined
    )
  const eeoConcepts: Record<(typeof EEO_DEFINITIONS)[number]["key"], Concept> =
    {
      gender: "eeo_gender",
      race_ethnicity: "eeo_race_ethnicity",
      disability: "eeo_disability",
      veteran: "eeo_veteran",
      protected_veteran: "eeo_protected_veteran",
    }
  for (const row of p.eeo.responses)
    if (row.answer.state !== "unanswered")
      add(
        eeoConcepts[row.questionKey],
        row.answer.state === "decline_to_answer"
          ? "Prefer not to say"
          : row.answer.code === "self_described"
            ? row.answer.text
            : row.answer.code.replaceAll("_", " "),
        "profile",
        `eeo.${row.questionKey}.${row.definitionVersion}`,
        `Autofill Profile: US ${row.questionKey.replaceAll("_", " ")} (${row.definitionVersion})`,
        undefined,
        "US"
      )
  const items = [
    ...resume.sections.flatMap((s) => s.items),
    ...supplementalRecords.map((r) => r.record),
  ]
  const experiences = items.filter((i) => i.kind === "experience")
  const applicationRecords = new Map(
    supplementalRecords.map((r) => [r.record.id, r.applicationId])
  )
  for (const item of items) {
    if (item.kind !== "experience" && item.kind !== "education") continue
    const name = item.kind === "experience" ? item.company : item.school
    const aliases = p.aliases
      .filter(
        (a) =>
          a.entityKind ===
            (item.kind === "experience" ? "company" : "school") &&
          a.canonicalName === name
      )
      .flatMap((a) => a.aliases)
    const source = `${name} / ${item.kind === "experience" ? item.role : (item.degree ?? "Education")} / ${item.start ?? ""}-${item.end ?? ""}`
    const values: [Concept, string | undefined, string][] =
      item.kind === "experience"
        ? [
            ["experience_company", item.company, "company"],
            ["experience_role", item.role, "role"],
            ["experience_start", item.start, "start"],
            ["experience_end", item.end, "end"],
          ]
        : [
            ["education_school", item.school, "school"],
            ["education_degree", item.degree, "degree"],
            ["education_field", item.field, "field"],
            ["education_start", item.start, "start"],
            ["education_end", item.end, "end"],
          ]
    for (const [concept, value, field] of values)
      add(
        concept,
        value,
        "resume",
        field,
        source,
        item.id,
        undefined,
        /_(company|school)$/.test(concept) ? aliases : [],
        applicationRecords.get(item.id)
      )
  }
  for (const item of experiences.filter((i) => i.end === "present"))
    add(
      "current_employer",
      item.company,
      "resume",
      "company",
      `${item.company} / ${item.role}`,
      item.id,
      undefined,
      [],
      applicationRecords.get(item.id)
    )
  const recent = [...experiences].sort((a, b) =>
    b.start.localeCompare(a.start)
  )[0]
  if (recent)
    for (const item of experiences.filter((i) => i.start === recent.start))
      add(
        "recent_employer",
        item.company,
        "resume",
        "company",
        `${item.company} / ${item.role}`,
        item.id,
        undefined,
        [],
        applicationRecords.get(item.id)
      )
  for (const override of overrides.filter((o) => meaningfulAnswer(o.value)))
    facts.push({
      factId: override.overrideId,
      concept: override.concept,
      value: override.value,
      sourceRef: {
        kind: "session_override",
        key: override.fieldId,
        overrideId: override.overrideId,
        revision: stamp.overridesRevision,
      },
      sourceLabel: "This session only",
      countryCode: override.countryCode,
      sensitive: true,
      aliases: [],
    })
  const profileFacts = new Set(
    facts
      .filter((fact) => fact.sourceRef.kind === "autofill_profile")
      .map((fact) => fact.factId)
  )
  return facts.filter(
    (fact) =>
      !["resume_head", "resume_version"].includes(fact.sourceRef.kind) ||
      !profileFacts.has(fact.factId)
  )
}
