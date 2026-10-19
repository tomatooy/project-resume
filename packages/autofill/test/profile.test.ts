import type { Resume } from "@workspace/resume-schema"
import { onePage } from "@workspace/resume-schema/fixtures"
import { describe, expect, it } from "vitest"

import {
  effectiveIdentity,
  emptyProfile,
  missingAnswers,
  type Profile,
  ProfileSchema,
  profileFromResume,
  splitName,
} from "../src/profile"

function withBasics(over: Partial<Resume["basics"]>): Resume["basics"] {
  return { ...onePage.basics, ...over }
}

describe("ProfileSchema", () => {
  it("parses an empty object into the empty profile", () => {
    expect(ProfileSchema.parse({})).toEqual(emptyProfile)
    expect(emptyProfile.eeo).toEqual({
      gender: "decline",
      hispanic: "decline",
      race: ["decline"],
      veteran: "decline",
      disability: "decline",
    })
    expect(emptyProfile.contact.country).toBe("United States")
  })

  it("validates phone, ZIP and state formats", () => {
    const valid = (contact: Partial<Profile["contact"]>) =>
      ProfileSchema.safeParse({ contact }).success
    expect([
      valid({ phone: "+14155550100" }),
      valid({ zip: "94103" }),
      valid({ zip: "94103-1234" }),
      valid({ state: "CA" }),
    ]).toEqual([true, true, true, true])
    expect([
      valid({ phone: "4155550100" }),
      valid({ zip: "9410" }),
      valid({ state: "Ca" }),
    ]).toEqual([false, false, false])
  })

  it("keeps decline out of a race list with categories", () => {
    const valid = (race: string[]) =>
      ProfileSchema.safeParse({ eeo: { race } }).success
    expect(valid(["asian", "white"])).toBe(true)
    expect(valid(["decline", "asian"])).toBe(false)
    expect(valid([])).toBe(false)
  })

  it("accepts only web addresses as links", () => {
    const valid = (github: string) =>
      ProfileSchema.safeParse({ links: { github } }).success
    expect(valid("https://github.com/mirah")).toBe(true)
    expect(valid("javascript:alert(1)")).toBe(false)
  })
})

describe("splitName", () => {
  it("splits names into first, middle and last", () => {
    expect(splitName("Ada King Lovelace")).toEqual({
      first: "Ada",
      middle: "King",
      last: "Lovelace",
    })
    expect(splitName("Cher")).toEqual({ first: "Cher", middle: "", last: "" })
    expect(splitName("  Mira   Halvorsen ")).toEqual({
      first: "Mira",
      middle: "",
      last: "Halvorsen",
    })
  })
})

describe("effectiveIdentity", () => {
  it("normalizes the resume phone to E.164", () => {
    const phone = (value: string) =>
      effectiveIdentity(emptyProfile, withBasics({ phone: value })).phone
    expect(phone("(415) 555-0100")).toBe("+14155550100")
    expect(phone("+47 400 12 345")).toBe("+4740012345")
    expect(phone("555-0100")).toBe("")
  })

  it("reads the state only when the location names a US state", () => {
    const place = (location: string) => {
      const { city, state } = effectiveIdentity(
        emptyProfile,
        withBasics({ location })
      )
      return `${city}|${state}`
    }
    expect(place("San Francisco, CA")).toBe("San Francisco|CA")
    expect(place("Austin, Texas")).toBe("Austin|TX")
    expect(place("Oslo, Norway")).toBe("Oslo|")
  })

  it("prefers the profile over the resume", () => {
    const profile = ProfileSchema.parse({
      contact: { phone: "+14155550100", city: "Bergen" },
    })
    const identity = effectiveIdentity(profile, onePage.basics)
    expect(`${identity.phone}|${identity.city}`).toBe("+14155550100|Bergen")
  })
})

describe("missingAnswers", () => {
  it("lists the nine common answers on an empty profile", () => {
    expect(missingAnswers(emptyProfile, null).map((m) => m.key)).toEqual([
      "name.first",
      "name.last",
      "contact.email",
      "contact.phone",
      "address.city",
      "address.state",
      "workAuth.authorized",
      "workAuth.sponsorship.now",
      "workAuth.sponsorship.future",
    ])
  })

  it("uses resume basics before asking", () => {
    expect(
      missingAnswers(emptyProfile, onePage.basics).map((m) => m.key)
    ).toEqual([
      "address.state",
      "workAuth.authorized",
      "workAuth.sponsorship.now",
      "workAuth.sponsorship.future",
    ])
  })

  it("points each answer at its profile section", () => {
    expect(
      missingAnswers(emptyProfile, onePage.basics).map((m) => m.anchor)
    ).toEqual([
      "contact",
      "work-authorization",
      "work-authorization",
      "work-authorization",
    ])
  })
})

describe("profileFromResume", () => {
  it("imports basics into empty fields only", () => {
    const imported = profileFromResume(emptyProfile, onePage)
    expect(imported.personal).toMatchObject({
      first: "Mira",
      last: "Halvorsen",
    })
    expect(imported.contact).toMatchObject({
      email: "mira@halvorsen.io",
      phone: "+4740012345",
      city: "Oslo",
      state: "",
    })
    expect(imported.links).toMatchObject({
      github: "https://github.com/mirah",
      linkedin: "https://linkedin.com/in/mirah",
    })
    const kept = profileFromResume(
      {
        ...emptyProfile,
        personal: { ...emptyProfile.personal, first: "Ada" },
      },
      onePage
    )
    expect(kept.personal.first).toBe("Ada")
  })

  it("puts the first other link in website and the rest in other", () => {
    const resume: Resume = {
      ...onePage,
      basics: withBasics({
        links: [
          { id: "lnk_aaaaaaaaaa", label: "Blog", url: "https://mira.dev" },
          { id: "lnk_bbbbbbbbbb", label: "", url: "https://talks.mira.dev/x" },
          { id: "lnk_cccccccccc", label: "Bad", url: "javascript:alert(1)" },
        ],
      }),
    }
    const imported = profileFromResume(emptyProfile, resume)
    expect(imported.links.website).toBe("https://mira.dev")
    expect(imported.links.other).toEqual([
      { label: "talks.mira.dev", url: "https://talks.mira.dev/x" },
    ])
    expect(ProfileSchema.safeParse(imported).success).toBe(true)
  })
})
