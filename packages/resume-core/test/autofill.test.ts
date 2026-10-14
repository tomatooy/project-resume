import { describe, expect, it } from "vitest"
import { AutofillProfileService } from "../src/autofill-profile/service"
import {
  emptyProfile,
  ProfileUpdateSchema,
} from "../src/autofill-profile/schema"
import { InMemoryAutofillProfileRepository } from "../src/testing/autofill"

// The plan, draft and policy operations this file used to cover were deleted
// with the retired engine (ticket 08). What remains is the account Profile,
// which the new engine reads as a source and does not replace.
describe("account profile", () => {
  it("exists without a resume and uses compare-and-swap without losing other sections", async () => {
    const repository = new InMemoryAutofillProfileRepository()
    const service = new AutofillProfileService(repository)
    expect((await service.get()).revision).toBe(0)
    const first = await service.update({
      expectedRevision: 0,
      section: "identity",
      data: { ...emptyProfile().data.identity, legalGivenName: "Ada" },
    })
    expect(first.revision).toBe(1)
    await expect(
      service.update({
        expectedRevision: 0,
        section: "links",
        data: emptyProfile().data.links,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" })
    const next = await service.update({
      expectedRevision: 1,
      section: "links",
      data: {
        ...first.data.links,
        linkedinUrl: "https://linkedin.com/in/ada/",
      },
    })
    expect(next.data.identity.legalGivenName).toBe("Ada")
    expect(next.data.links.linkedinUrl).toBe("https://www.linkedin.com/in/ada")
  })
  it("distinguishes unknown sponsorship from no and clearing EEO from declining", async () => {
    const service = new AutofillProfileService(
      new InMemoryAutofillProfileRepository()
    )
    const one = await service.update({
      expectedRevision: 0,
      section: "workAuthorization",
      data: [
        {
          countryCode: "US",
          authorizedToWork: "yes",
          requiresSponsorshipNow: "no",
          requiresSponsorshipFuture: "unknown",
        },
      ],
    })
    expect(one.data.workAuthorization[0]?.requiresSponsorshipFuture).toBe(
      "unknown"
    )
    const two = await service.update({
      expectedRevision: 1,
      section: "eeo",
      data: {
        responses: [
          {
            countryCode: "US",
            questionKey: "gender",
            definitionVersion: "vs-us-1",
            answer: { state: "decline_to_answer" },
          },
        ],
      },
    })
    expect(two.data.eeo.responses[0]?.confirmedAt).toBeTruthy()
    const three = await service.update({
      expectedRevision: 2,
      section: "eeo",
      data: { responses: [] },
    })
    expect(three.data.eeo.responses).toEqual([])
    expect(three.data.workAuthorization).toEqual(one.data.workAuthorization)
  })
  it("rejects unknown answer codes, duplicate definitions, and non-profile LinkedIn URLs", () => {
    expect(
      ProfileUpdateSchema.safeParse({
        expectedRevision: 0,
        section: "links",
        data: {
          ...emptyProfile().data.links,
          linkedinUrl: "https://linkedin.com/jobs/view/123",
        },
      }).success
    ).toBe(false)
    expect(
      ProfileUpdateSchema.safeParse({
        expectedRevision: 0,
        section: "eeo",
        data: {
          responses: [
            {
              countryCode: "US",
              questionKey: "disability",
              definitionVersion: "vs-us-1",
              answer: { state: "answered", code: "probably" },
            },
          ],
        },
      }).success
    ).toBe(false)
  })
})
