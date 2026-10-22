import { z } from "zod"

/** The sections of the Autofill profile page, in page order. */
export const ProfileSectionSchema = z.enum([
  "personal",
  "contact",
  "links",
  "work-authorization",
  "preferences",
  "eeo",
  "other",
  "notes",
])
export type ProfileSection = z.infer<typeof ProfileSectionSchema>

/**
 * What a form field asks for, independent of how the page words it. Rules
 * fill a field by its key; `resume.*` keys read the chosen resume.
 */
export const CanonicalKeySchema = z.enum([
  "name.full",
  "name.first",
  "name.middle",
  "name.last",
  "name.preferred",
  "name.pronouns",
  "contact.email",
  "contact.phone",
  "contact.phone.country",
  "contact.phone.national",
  "address.street",
  "address.apartment",
  "address.city",
  "address.state",
  "address.zip",
  "address.country",
  "address.location",
  "links.linkedin",
  "links.github",
  "links.portfolio",
  "links.website",
  "links.twitter",
  "links.combined",
  "workAuth.authorized",
  "workAuth.sponsorship.now",
  "workAuth.sponsorship.future",
  "workAuth.sponsorship.any",
  "workAuth.status",
  "workAuth.expiry",
  "pref.salary",
  "pref.start",
  "pref.relocation",
  "pref.workMode",
  "pref.cities",
  "other.adult",
  "other.backgroundCheck",
  "other.driversLicense",
  "other.languages",
  "resume.company",
  "resume.title",
  "resume.school",
  "resume.degree",
  "resume.major",
  "resume.graduation",
  "resume.years",
  "resume.skills",
  "resume.file",
  "source.how-heard",
])
export type CanonicalKey = z.infer<typeof CanonicalKeySchema>
