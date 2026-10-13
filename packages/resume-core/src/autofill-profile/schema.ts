import { z } from "zod"
import { COUNTRY_CODES } from "./countries"

const text = z.string().trim().max(500)
const country = z
  .string()
  .refine(
    (value) => COUNTRY_CODES.has(value),
    "Use an ISO two-letter country code"
  )
const answer = z.enum(["unknown", "yes", "no"])
const url = z.union([z.literal(""), z.url().max(2000)])
export const EEO_DEFINITIONS = [
  {
    key: "gender",
    title: "Gender identity",
    codes: ["woman", "man", "nonbinary", "self_described"],
  },
  {
    key: "race_ethnicity",
    title: "Race / ethnicity (US application categories)",
    codes: [
      "hispanic_or_latino",
      "white",
      "black_or_african_american",
      "asian",
      "american_indian_or_alaska_native",
      "native_hawaiian_or_pacific_islander",
      "two_or_more_races",
    ],
  },
  {
    key: "disability",
    title: "Do you have, or have you previously had, a disability?",
    codes: ["yes", "no"],
  },
  {
    key: "veteran",
    title: "Have you served in the US military?",
    codes: ["yes", "no"],
  },
  {
    key: "protected_veteran",
    title:
      "Are you a disabled veteran, recently separated veteran, active duty wartime or campaign badge veteran, or Armed Forces service medal veteran?",
    codes: ["yes", "no"],
  },
] as const
export const EeoQuestionSchema = z.enum([
  "gender",
  "race_ethnicity",
  "disability",
  "veteran",
  "protected_veteran",
])
export const EeoResponseSchema = z
  .strictObject({
    countryCode: z.literal("US"),
    questionKey: EeoQuestionSchema,
    definitionVersion: z.literal("vs-us-1"),
    answer: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("unanswered") }),
      z.strictObject({ state: z.literal("decline_to_answer") }),
      z.strictObject({
        state: z.literal("answered"),
        code: text.min(1),
        text: text.optional(),
      }),
    ]),
    confirmedAt: z.iso.datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.answer.state === "unanswered" && value.confirmedAt)
      ctx.addIssue({
        code: "custom",
        message: "Unanswered information has no confirmation time",
      })
    if (value.answer.state === "answered") {
      const definition = EEO_DEFINITIONS.find(
        (d) => d.key === value.questionKey
      )
      const selected = value.answer.code
      if (!definition?.codes.some((code) => code === selected))
        ctx.addIssue({
          code: "custom",
          path: ["answer", "code"],
          message: "Choose an answer from this question's definition",
        })
      if (value.answer.code !== "self_described" && value.answer.text)
        ctx.addIssue({
          code: "custom",
          path: ["answer", "text"],
          message: "This answer does not accept a separate description",
        })
      if (value.answer.code === "self_described" && !value.answer.text)
        ctx.addIssue({
          code: "custom",
          path: ["answer", "text"],
          message: "Enter your own description",
        })
    }
  })
export const ProfileSections = {
  identity: z.strictObject({
    displayName: text.optional(),
    email: z.union([z.literal(""), z.email()]).optional(),
    phone: text.optional(),
    legalGivenName: text,
    legalMiddleName: text,
    legalFamilyName: text,
    preferredName: text,
  }),
  links: z.strictObject({
    linkedinUrl: url.refine(
      (value) =>
        !value ||
        /^https:\/\/(?:www\.)?linkedin\.com\/in\/[^/?#]+\/?$/i.test(value),
      "Use a LinkedIn personal profile URL"
    ),
    githubUrl: url,
    portfolioUrl: url,
    websiteUrl: url,
  }),
  address: z.strictObject({
    countryCode: z.union([z.literal(""), country]),
    addressLine1: text,
    addressLine2: text,
    city: text,
    administrativeArea: text,
    postalCode: text.max(30),
  }),
  workAuthorization: z
    .array(
      z.strictObject({
        countryCode: country,
        authorizedToWork: answer,
        requiresSponsorshipNow: answer,
        requiresSponsorshipFuture: answer,
        confirmedAt: z.iso.datetime().optional(),
      })
    )
    .max(100)
    .refine(
      (rows) => new Set(rows.map((r) => r.countryCode)).size === rows.length,
      "Use one entry per country"
    ),
  eeo: z.strictObject({
    responses: z
      .array(EeoResponseSchema)
      .max(30)
      .refine(
        (rows) =>
          new Set(
            rows.map(
              (r) => `${r.countryCode}:${r.questionKey}:${r.definitionVersion}`
            )
          ).size === rows.length,
        "Duplicate EEO question"
      ),
  }),
  preferences: z.strictObject({
    countryCode: z.union([z.literal(""), country]),
    availableFrom: z.union([z.literal(""), z.iso.date()]),
    willingToRelocate: answer,
    salaryAmount: z.number().nonnegative().max(1_000_000_000).nullable(),
    salaryCurrency: z.union([z.literal(""), z.string().regex(/^[A-Z]{3}$/)]),
    salaryPeriod: z.enum(["unknown", "hour", "month", "year"]),
  }),
  aliases: z
    .array(
      z.strictObject({
        entityKind: z.enum(["school", "company"]),
        canonicalName: text.min(1),
        aliases: z.array(text.min(1)).max(20),
      })
    )
    .max(100),
}
export const ProfileDataSchema = z.strictObject(ProfileSections)
export type ProfileData = z.infer<typeof ProfileDataSchema>
export const ProfileSectionSchema = z.enum([
  "identity",
  "links",
  "address",
  "workAuthorization",
  "eeo",
  "preferences",
  "aliases",
])
export type ProfileSection = z.infer<typeof ProfileSectionSchema>
const revision = z.number().int().nonnegative()
export const AutofillProfileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision,
  data: ProfileDataSchema,
})
export type AutofillProfile = z.infer<typeof AutofillProfileSchema>
export const ProfileUpdateSchema = z.discriminatedUnion("section", [
  z.strictObject({
    expectedRevision: revision,
    section: z.literal("identity"),
    data: ProfileSections.identity,
  }),
  z.strictObject({
    expectedRevision: revision,
    section: z.literal("links"),
    data: ProfileSections.links,
  }),
  z.strictObject({
    expectedRevision: revision,
    section: z.literal("address"),
    data: ProfileSections.address,
  }),
  z.strictObject({
    expectedRevision: revision,
    section: z.literal("workAuthorization"),
    data: ProfileSections.workAuthorization,
  }),
  z.strictObject({
    expectedRevision: revision,
    section: z.literal("eeo"),
    data: ProfileSections.eeo,
  }),
  z.strictObject({
    expectedRevision: revision,
    section: z.literal("preferences"),
    data: ProfileSections.preferences,
  }),
  z.strictObject({
    expectedRevision: revision,
    section: z.literal("aliases"),
    data: ProfileSections.aliases,
  }),
])
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>
export function emptyProfile(): AutofillProfile {
  return {
    schemaVersion: 1,
    revision: 0,
    data: {
      identity: {
        legalGivenName: "",
        legalMiddleName: "",
        legalFamilyName: "",
        preferredName: "",
      },
      links: {
        linkedinUrl: "",
        githubUrl: "",
        portfolioUrl: "",
        websiteUrl: "",
      },
      address: {
        countryCode: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        administrativeArea: "",
        postalCode: "",
      },
      workAuthorization: [],
      eeo: { responses: [] },
      preferences: {
        countryCode: "",
        availableFrom: "",
        willingToRelocate: "unknown",
        salaryAmount: null,
        salaryCurrency: "",
        salaryPeriod: "unknown",
      },
      aliases: [],
    },
  }
}
