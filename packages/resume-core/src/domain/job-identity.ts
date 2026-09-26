import { z } from "zod"
import { normalizeLinkedInJobUrl } from "./linkedin"

export const JobPlatformSchema = z.enum(["linkedin", "indeed"])

// The current fetch and extension APIs accept LinkedIn identities only.
export const JobIdentitySchema = z.object({
  platform: z.literal("linkedin"),
  externalJobId: z.string().regex(/^\d{6,}$/),
})
export type JobIdentity = z.infer<typeof JobIdentitySchema>
export const NullableJobIdentitySchema = z.union([
  JobIdentitySchema,
  z.object({
    platform: JobPlatformSchema.extract(["indeed"]),
    externalJobId: z.string().min(1).max(200),
  }),
  z.object({ platform: z.null(), externalJobId: z.null() }),
])
export function jobIdentityFromUrl(input: string): JobIdentity | null {
  const canonical = normalizeLinkedInJobUrl(input)
  const externalJobId = canonical?.split("/")[5]
  return externalJobId ? { platform: "linkedin", externalJobId } : null
}
export function canonicalJobUrl(identity: JobIdentity): string {
  return `https://www.linkedin.com/jobs/view/${identity.externalJobId}/`
}
