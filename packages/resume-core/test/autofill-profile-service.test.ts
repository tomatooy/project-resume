import { emptyProfile, PROFILE_SCHEMA_VERSION } from "@workspace/autofill"
import { sampleProfile } from "@workspace/autofill/fixtures"
import { describe, expect, it } from "vitest"

import { harness } from "./harness"

describe("AutofillProfileService", () => {
  it("returns the empty profile before the first save", async () => {
    const h = harness()
    expect(await h.autofillProfileService.get()).toEqual({
      profile: emptyProfile,
      revision: 0,
      updatedAt: null,
      exists: false,
    })
  })

  it("saves with a revision check", async () => {
    const h = harness()
    expect(
      (
        await h.autofillProfileService.save({
          profile: sampleProfile,
          expectedRevision: 0,
        })
      ).revision
    ).toBe(1)
    await expect(
      h.autofillProfileService.save({
        profile: sampleProfile,
        expectedRevision: 0,
      })
    ).rejects.toMatchObject({ code: "CONFLICT", message: "Profile changed" })
  })

  it("reads back the saved profile with the current schema version", async () => {
    const h = harness()
    const saved = await h.autofillProfileService.save({
      profile: sampleProfile,
      expectedRevision: 0,
    })
    expect(await h.autofillProfileService.get()).toEqual({
      profile: sampleProfile,
      revision: 1,
      updatedAt: saved.updatedAt,
      exists: true,
    })
    expect(h.db.autofillProfile?.schemaVersion).toBe(PROFILE_SCHEMA_VERSION)
  })

  it("moves the revision only when the profile changes", async () => {
    const h = harness()
    const first = await h.autofillProfileService.save({
      profile: sampleProfile,
      expectedRevision: 0,
    })
    expect(
      await h.autofillProfileService.save({
        profile: sampleProfile,
        expectedRevision: 1,
      })
    ).toEqual(first)
    const preferred = {
      ...sampleProfile,
      personal: { ...sampleProfile.personal, preferred: "Ada L." },
    }
    expect(
      (
        await h.autofillProfileService.save({
          profile: preferred,
          expectedRevision: 1,
        })
      ).revision
    ).toBe(2)
  })

  it("replaces the stored profile on a later save", async () => {
    const h = harness()
    await h.autofillProfileService.save({
      profile: sampleProfile,
      expectedRevision: 0,
    })
    const preferred = {
      ...sampleProfile,
      personal: { ...sampleProfile.personal, preferred: "Ada L." },
    }
    await h.autofillProfileService.save({
      profile: preferred,
      expectedRevision: 1,
    })
    expect((await h.autofillProfileService.get()).profile).toEqual(preferred)
  })
})
