import type { Resume } from "@workspace/resume-schema"
import { z } from "zod"

import type { CanonicalKey, ProfileSection } from "./keys"
import { US_STATES } from "./match"

export const PROFILE_SCHEMA_VERSION = 1

const E164 = /^\+[1-9]\d{6,14}$/

const YesNo = z.enum(["yes", "no"]).nullable().default(null)
const IsoDateOrEmpty = z.union([z.iso.date(), z.literal("")]).default("")
/** A `javascript:` address is a valid URL, but never a link we would fill in. */
const WebUrl = z.url({ protocol: /^https?$/ })
const WebUrlOrEmpty = z.union([WebUrl, z.literal("")]).default("")

const PersonalSchema = z.object({
  first: z.string().default(""),
  middle: z.string().default(""),
  last: z.string().default(""),
  preferred: z.string().default(""),
  pronouns: z
    .enum(["she/her", "he/him", "they/them", "custom"])
    .nullable()
    .default(null),
  pronounsCustom: z.string().max(40).default(""),
})

const ContactSchema = z.object({
  email: z.union([z.email(), z.literal("")]).default(""),
  phone: z.union([z.string().regex(E164), z.literal("")]).default(""),
  street: z.string().default(""),
  apartment: z.string().default(""),
  city: z.string().default(""),
  state: z.union([z.string().regex(/^[A-Z]{2}$/), z.literal("")]).default(""),
  zip: z
    .union([z.string().regex(/^\d{5}(-\d{4})?$/), z.literal("")])
    .default(""),
  country: z.string().default("United States"),
})

const LinksSchema = z.object({
  linkedin: WebUrlOrEmpty,
  github: WebUrlOrEmpty,
  portfolio: WebUrlOrEmpty,
  website: WebUrlOrEmpty,
  other: z
    .array(z.object({ label: z.string().min(1).max(40), url: WebUrl }))
    .max(10)
    .default([]),
})

const WorkAuthSchema = z.object({
  authorized: YesNo,
  sponsorshipNow: YesNo,
  sponsorshipFuture: YesNo,
  status: z
    .enum([
      "citizen",
      "permanent-resident",
      "h1b",
      "f1-opt",
      "f1-stem-opt",
      "other",
    ])
    .nullable()
    .default(null),
  statusOther: z.string().max(100).default(""),
  expiry: IsoDateOrEmpty,
})

const PreferencesSchema = z.object({
  salaryMin: z.number().int().positive().nullable().default(null),
  salaryMax: z.number().int().positive().nullable().default(null),
  currency: z.string().default("USD"),
  salaryPeriod: z.enum(["year", "hour"]).default("year"),
  startKind: z.enum(["date", "notice"]).nullable().default(null),
  startDate: IsoDateOrEmpty,
  noticeWeeks: z.number().int().min(0).max(52).nullable().default(null),
  relocation: YesNo,
  workModes: z.array(z.enum(["remote", "hybrid", "onsite"])).default([]),
  cities: z.array(z.string().max(100)).max(10).default([]),
})

const EeoSchema = z.object({
  gender: z
    .enum(["male", "female", "non-binary", "decline"])
    .default("decline"),
  hispanic: z.enum(["yes", "no", "decline"]).default("decline"),
  /** Either `["decline"]` alone or one or more categories. */
  race: z
    .array(
      z.enum([
        "decline",
        "american-indian",
        "asian",
        "black",
        "pacific-islander",
        "white",
      ])
    )
    .min(1)
    .refine((race) => !race.includes("decline") || race.length === 1, {
      message: "Decline cannot be combined with a category",
    })
    .default(["decline"]),
  veteran: z
    .enum(["protect-veteran", "not-protected-veteran", "decline"])
    .default("decline"),
  disability: z.enum(["yes", "no", "decline"]).default("decline"),
})

const OtherSchema = z.object({
  adult: YesNo,
  backgroundCheck: YesNo,
  driversLicense: YesNo,
  languages: z
    .array(
      z.object({
        language: z.string().min(1).max(60),
        level: z.enum(["native", "fluent", "professional", "basic"]),
      })
    )
    .max(10)
    .default([]),
})

/**
 * Every section prefaults to `{}`, so `ProfileSchema.parse({})` is the full
 * empty Profile. (`.default` would return `{}` unparsed.)
 */
export const ProfileSchema = z.object({
  personal: PersonalSchema.prefault({}),
  contact: ContactSchema.prefault({}),
  links: LinksSchema.prefault({}),
  workAuth: WorkAuthSchema.prefault({}),
  preferences: PreferencesSchema.prefault({}),
  eeo: EeoSchema.prefault({}),
  other: OtherSchema.prefault({}),
})
export type Profile = z.infer<typeof ProfileSchema>

export const emptyProfile: Profile = ProfileSchema.parse({})

export function splitName(full: string): {
  first: string
  middle: string
  last: string
} {
  const [first = "", ...rest] = full.trim().split(/\s+/).filter(Boolean)
  const last = rest.pop() ?? ""
  return { first, middle: rest.join(" "), last }
}

export type Identity = {
  first: string
  middle: string
  last: string
  preferred: string
  email: string
  phone: string
  city: string
  state: string
}

/** E.164, or "" when the number cannot be read without guessing a country. */
function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, "")
  if (raw.trim().startsWith("+")) {
    const phone = `+${digits}`
    return E164.test(phone) ? phone : ""
  }
  return digits.length === 10 ? `+1${digits}` : ""
}

function stateCode(value: string): string {
  const code = value.toUpperCase()
  if (Object.hasOwn(US_STATES, code)) return code
  const name = value.toLowerCase()
  for (const [state, stateName] of Object.entries(US_STATES)) {
    if (stateName.toLowerCase() === name) return state
  }
  return ""
}

/** "City, ST": the state counts only when it is a US state code or name. */
function place(location: string | undefined): { city: string; state: string } {
  const [city = "", region = ""] = (location ?? "")
    .split(",")
    .map((part) => part.trim())
  return { city, state: stateCode(region) }
}

/** The Profile's identity, with each empty value taken from the resume. */
export function effectiveIdentity(
  profile: Profile,
  basics: Resume["basics"] | null
): Identity {
  const name = splitName(basics?.name ?? "")
  const where = place(basics?.location)
  const { personal, contact } = profile
  return {
    first: personal.first || name.first,
    middle: personal.middle || name.middle,
    last: personal.last || name.last,
    preferred: personal.preferred,
    email: contact.email || (basics?.email ?? ""),
    phone: contact.phone || toE164(basics?.phone ?? ""),
    city: contact.city || where.city,
    state: contact.state || where.state,
  }
}

export type MissingAnswer = { key: CanonicalKey; anchor: ProfileSection }

/** The nine answers most forms ask for, in Profile page order. */
export function missingAnswers(
  profile: Profile,
  basics: Resume["basics"] | null
): MissingAnswer[] {
  const identity = effectiveIdentity(profile, basics)
  const { workAuth } = profile
  const answers: [CanonicalKey, ProfileSection, boolean][] = [
    ["name.first", "personal", identity.first === ""],
    ["name.last", "personal", identity.last === ""],
    ["contact.email", "contact", identity.email === ""],
    ["contact.phone", "contact", identity.phone === ""],
    ["address.city", "contact", identity.city === ""],
    ["address.state", "contact", identity.state === ""],
    ["workAuth.authorized", "work-authorization", workAuth.authorized === null],
    [
      "workAuth.sponsorship.now",
      "work-authorization",
      workAuth.sponsorshipNow === null,
    ],
    [
      "workAuth.sponsorship.future",
      "work-authorization",
      workAuth.sponsorshipFuture === null,
    ],
  ]
  return answers
    .filter(([, , missing]) => missing)
    .map(([key, anchor]) => ({ key, anchor }))
}

function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase()
}

function onHost(url: string, host: string): boolean {
  const name = hostOf(url)
  return name === host || name.endsWith(`.${host}`)
}

function importLinks(
  current: Profile["links"],
  links: Resume["basics"]["links"]
): Profile["links"] {
  const web = links.filter((link) => WebUrl.safeParse(link.url).success)
  const linkedin = web.find((link) => onHost(link.url, "linkedin.com"))
  const github = web.find((link) => onHost(link.url, "github.com"))
  const others = web.filter((link) => link !== linkedin && link !== github)
  return {
    ...current,
    linkedin: current.linkedin || (linkedin?.url ?? ""),
    github: current.github || (github?.url ?? ""),
    website: current.website || (others[0]?.url ?? ""),
    other:
      current.other.length > 0
        ? current.other
        : others.slice(1).map((link) => ({
            label: (
              link.label.trim() || hostOf(link.url).replace(/^www\./, "")
            ).slice(0, 40),
            url: link.url,
          })),
  }
}

/** Fills empty Profile fields from the resume; never overwrites a value. */
export function profileFromResume(profile: Profile, resume: Resume): Profile {
  const identity = effectiveIdentity(profile, resume.basics)
  return {
    ...profile,
    personal: {
      ...profile.personal,
      first: identity.first,
      middle: identity.middle,
      last: identity.last,
    },
    contact: {
      ...profile.contact,
      email: identity.email,
      phone: identity.phone,
      city: identity.city,
      state: identity.state,
    },
    links: importLinks(profile.links, resume.basics.links),
  }
}
