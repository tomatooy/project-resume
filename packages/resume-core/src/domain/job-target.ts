import { z } from "zod"
import { NullableJobIdentitySchema } from "./job-identity"

/**
 * The model's reading of a posting. Flat arrays of short strings, for the same
 * reason `ParsedResumeSchema` is flat: a flash model given `anyOf` or nesting
 * produces valid JSON of the wrong shape often enough to matter.
 */
export const ParsedJobPostingSchema = z.object({
  title: z.string().max(200),
  company: z.string().max(200),
  location: z.string().max(200).optional(),
  /** Requirements stated as required. */
  mustHaves: z.array(z.string().max(300)).max(20),
  /** Requirements stated as preferred, bonus, or nice to have. */
  niceToHaves: z.array(z.string().max(300)).max(20),
  /** Tools, languages and named skills, as the posting spells them. */
  keywords: z.array(z.string().max(80)).max(40),
})
export type ParsedJobPosting = z.infer<typeof ParsedJobPostingSchema>

/** What is stored on the row: the posting minus the fields with columns. */
export const JobRequirementsSchema = ParsedJobPostingSchema.pick({
  mustHaves: true,
  niceToHaves: true,
  keywords: true,
})
export type JobRequirements = z.infer<typeof JobRequirementsSchema>

export const JobTargetSchema = z
  .object({
    id: z.string(),
    sourceUrl: z.string().nullable(),
    rawText: z.string(),
    title: z.string(),
    company: z.string(),
    location: z.string().nullable(),
    requirements: JobRequirementsSchema,
    createdAt: z.string(),
  })
  .and(NullableJobIdentitySchema)
export type JobTarget = z.infer<typeof JobTargetSchema>
export const NewJobTargetSchema = z
  .object({
    sourceUrl: z.string().nullable(),
    rawText: z.string(),
    title: z.string(),
    company: z.string(),
    location: z.string().nullable(),
    requirements: JobRequirementsSchema,
  })
  .and(NullableJobIdentitySchema)
export type NewJobTarget = z.infer<typeof NewJobTargetSchema>

/** The same ceiling import uses, for the same reason: one model call's worth. */
export const MAX_JOB_CHARS = 20_000
/** Below this it is a job title, not a posting, and tailoring has nothing to go on. */
export const MIN_JOB_CHARS = 200
