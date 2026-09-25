import type {
  Resume,
  TemplateId,
  TemplateOptions,
} from "@workspace/resume-schema"

import { z } from "zod"
import { TemplateIdSchema } from "@workspace/resume-schema"
export const ResumeSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  templateId: TemplateIdSchema,
  updatedAt: z.string(),
})
export type ResumeSummary = z.infer<typeof ResumeSummarySchema>

export type ResumeRecord = ResumeSummary & {
  data: Resume
  schemaVersion: number
  templateOptions: TemplateOptions
  currentVersionId: string | null
  /**
   * The optimistic-concurrency token. Deliberately not `updatedAt`: a rename or
   * a template switch moves the timestamp but not the token, so neither turns
   * the next autosave into a conflict the user never caused.
   */
  revision: number
}

/** What a repository needs to insert a row. Ids and timestamps are its job. */
export type NewResume = {
  title: string
  subtitle: string
  data: Resume
  schemaVersion: number
  templateId: TemplateId
  templateOptions: TemplateOptions
}

/** What the caller must hold after any write that moves the head. */
export type HeadWrite = {
  revision: number
  updatedAt: string
}
