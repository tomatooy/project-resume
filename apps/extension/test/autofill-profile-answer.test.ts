import { expect, it } from "vitest"
import { createServices } from "@workspace/resume-core"
import { inMemoryPorts } from "@workspace/resume-core/testing"
import {
  ProfileUpdateSchema,
  type ApplicationAnswer,
} from "@workspace/resume-core/contracts"
import { profileUpdateForAnswer } from "../src/autofill/profile-answer"

function answer(
  concept: ApplicationAnswer["meaning"]["concept"],
  value: string
): ApplicationAnswer {
  return {
    answerId: crypto.randomUUID(),
    applicationId: "app",
    meaning: { concept },
    conditions: { countryCode: "CA" },
    value,
    confirmed: true,
    provenance: { kind: "user" },
  }
}

it("preserves unrelated profile values while proposing an explicit identity update", async () => {
  const services = createServices(inMemoryPorts())
  const profile = await services.autofillProfile.get()
  profile.data.identity.legalGivenName = "Original"
  const update = profileUpdateForAnswer(
    profile,
    answer("contact_email", "confirmed@example.test")
  )
  expect(ProfileUpdateSchema.parse(update)).toMatchObject({
    expectedRevision: profile.revision,
    section: "identity",
    data: { legalGivenName: "Original", email: "confirmed@example.test" },
  })
  expect(profile.data.identity.email).not.toBe("confirmed@example.test")
})

it("keeps a negative work answer country-specific without inferring other permissions", async () => {
  const services = createServices(inMemoryPorts())
  const profile = await services.autofillProfile.get()
  const update = profileUpdateForAnswer(
    profile,
    answer("work_authorized", "No")
  )
  expect(ProfileUpdateSchema.parse(update)).toMatchObject({
    section: "workAuthorization",
    data: [
      {
        countryCode: "CA",
        authorizedToWork: "no",
        requiresSponsorshipNow: "unknown",
        requiresSponsorshipFuture: "unknown",
      },
    ],
  })
  expect(
    profileUpdateForAnswer(profile, answer("sponsorship_now_or_future", "Yes"))
  ).toBeNull()
  expect(
    profileUpdateForAnswer(profile, {
      ...answer("work_authorized", "Yes"),
      conditions: {},
    })
  ).toBeNull()
})

it("does not write record facts or generated prose into the profile", async () => {
  const services = createServices(inMemoryPorts())
  const profile = await services.autofillProfile.get()
  for (const concept of [
    "experience_company",
    "education_school",
    "open_answer",
    "salary",
  ] as const)
    expect(
      profileUpdateForAnswer(profile, answer(concept, "confirmed"))
    ).toBeNull()
})
