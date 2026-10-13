import { AppError } from "../domain/errors"
import {
  AutofillProfileSchema,
  ProfileDataSchema,
  ProfileUpdateSchema,
  emptyProfile,
  type AutofillProfile,
  type ProfileData,
  type ProfileUpdate,
} from "./schema"

export interface AutofillProfileRepository {
  get(): Promise<AutofillProfile | null>
  save(
    expectedRevision: number,
    data: ProfileData
  ): Promise<AutofillProfile | null>
}
export class AutofillProfileService {
  constructor(
    private readonly repository: AutofillProfileRepository,
    private readonly clock: () => Date = () => new Date()
  ) {}
  async get(): Promise<AutofillProfile> {
    return AutofillProfileSchema.parse(
      (await this.repository.get()) ?? emptyProfile()
    )
  }
  async update(input: ProfileUpdate): Promise<AutofillProfile> {
    const checked = ProfileUpdateSchema.safeParse(input)
    if (!checked.success)
      throw new AppError("VALIDATION", "Invalid profile section")
    const current = await this.get()
    if (current.revision !== input.expectedRevision)
      throw new AppError(
        "CONFLICT",
        "Profile changed. Review the latest saved information.",
        undefined,
        undefined,
        "profile_conflict"
      )
    const data = ProfileDataSchema.parse({
      ...current.data,
      [input.section]: checked.data.data,
    })
    if (input.section === "eeo")
      data.eeo.responses = data.eeo.responses.map((row) => ({
        ...row,
        confirmedAt:
          row.answer.state === "unanswered"
            ? undefined
            : this.clock().toISOString(),
      }))
    if (input.section === "workAuthorization")
      data.workAuthorization = data.workAuthorization.map((row) => ({
        ...row,
        confirmedAt: this.clock().toISOString(),
      }))
    if (input.section === "links" && data.links.linkedinUrl) {
      const parsed = new URL(data.links.linkedinUrl)
      data.links.linkedinUrl = `https://www.linkedin.com${parsed.pathname.replace(/\/$/, "")}`
    }
    const saved = await this.repository.save(input.expectedRevision, data)
    if (!saved)
      throw new AppError(
        "CONFLICT",
        "Profile changed. Review the latest saved information.",
        undefined,
        undefined,
        "profile_conflict"
      )
    return AutofillProfileSchema.parse(saved)
  }
}
