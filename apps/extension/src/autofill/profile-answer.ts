import type {
  ApplicationAnswer,
  AutofillProfile,
  ProfileData,
  ProfileUpdate,
} from "@workspace/resume-core/contracts"

export function profileUpdateForAnswer(
  profile: AutofillProfile,
  answer: ApplicationAnswer
): ProfileUpdate | null {
  const expectedRevision = profile.revision
  const value = answer.value
  const identity = (key: keyof ProfileData["identity"]): ProfileUpdate => ({
    expectedRevision,
    section: "identity",
    data: { ...profile.data.identity, [key]: value },
  })
  const link = (key: keyof ProfileData["links"]): ProfileUpdate => ({
    expectedRevision,
    section: "links",
    data: { ...profile.data.links, [key]: value },
  })
  const address = (key: keyof ProfileData["address"]): ProfileUpdate => ({
    expectedRevision,
    section: "address",
    data: { ...profile.data.address, [key]: value },
  })
  const work = (
    key:
      | "authorizedToWork"
      | "requiresSponsorshipNow"
      | "requiresSponsorshipFuture"
  ): ProfileUpdate | null => {
    const countryCode = answer.conditions.countryCode
    const selected = value.trim().toLowerCase()
    if (!countryCode || (selected !== "yes" && selected !== "no")) return null
    const rows = [...profile.data.workAuthorization]
    const previous =
      rows.find((row) => row.countryCode === countryCode) ??
      ({
        countryCode,
        authorizedToWork: "unknown",
        requiresSponsorshipNow: "unknown",
        requiresSponsorshipFuture: "unknown",
      } satisfies ProfileData["workAuthorization"][number])
    return {
      expectedRevision,
      section: "workAuthorization",
      data: [
        ...rows.filter((row) => row.countryCode !== countryCode),
        { ...previous, [key]: selected },
      ],
    }
  }
  switch (answer.meaning.concept) {
    case "display_name":
      return identity("displayName")
    case "contact_email":
      return identity("email")
    case "contact_phone":
      return identity("phone")
    case "legal_given_name":
      return identity("legalGivenName")
    case "legal_middle_name":
      return identity("legalMiddleName")
    case "legal_family_name":
      return identity("legalFamilyName")
    case "preferred_name":
      return identity("preferredName")
    case "linkedin_url":
      return link("linkedinUrl")
    case "github_url":
      return link("githubUrl")
    case "portfolio_url":
      return link("portfolioUrl")
    case "website_url":
      return link("websiteUrl")
    case "country":
      return /^[A-Z]{2}$/.test(value) ? address("countryCode") : null
    case "address_line1":
      return address("addressLine1")
    case "address_line2":
      return address("addressLine2")
    case "city":
      return address("city")
    case "administrative_area":
      return address("administrativeArea")
    case "postal_code":
      return address("postalCode")
    case "work_authorized":
      return work("authorizedToWork")
    case "sponsorship_now":
      return work("requiresSponsorshipNow")
    case "sponsorship_future":
      return work("requiresSponsorshipFuture")
    default:
      return null
  }
}
