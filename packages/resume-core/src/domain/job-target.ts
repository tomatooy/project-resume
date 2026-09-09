import { z } from "zod"

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

export type JobTarget = {
  id: string
  /** Null when the user pasted the description rather than giving a link. */
  sourceUrl: string | null
  rawText: string
  title: string
  company: string
  location: string | null
  requirements: JobRequirements
  createdAt: string
}

export type NewJobTarget = Omit<JobTarget, "id" | "createdAt">

/** The same ceiling import uses, for the same reason: one model call's worth. */
export const MAX_JOB_CHARS = 20_000
/** Below this it is a job title, not a posting, and tailoring has nothing to go on. */
export const MIN_JOB_CHARS = 200
