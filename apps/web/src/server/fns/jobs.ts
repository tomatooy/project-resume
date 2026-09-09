import { createServerFn } from "@tanstack/react-start"
import { MAX_JOB_CHARS } from "@workspace/resume-core"
import { z } from "zod"

import { serve } from "../handler"
import { errorClassOf } from "../log"

/**
 * Fetches a LinkedIn posting so the user can read it before generating.
 *
 * The log records that a fetch happened and how it ended, never the URL and
 * never the text: a job link identifies what a person is applying for.
 */
export const fetchJobPosting = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string().max(2000) }))
  .handler(
    serve(async ({ services, log, data }) => {
      const startedAt = Date.now()
      try {
        const result = await services.tailor.fetchPosting(data.url)
        log.info("job_fetch_finished", {
          charCount: result.text.length,
          latencyMs: Date.now() - startedAt,
        })
        return result
      } catch (error) {
        log.warn("job_fetch_failed", {
          errorClass: errorClassOf(error),
          latencyMs: Date.now() - startedAt,
        })
        throw error
      }
    })
  )

/**
 * Creates the resume. Two model calls behind one request, so the log records
 * which of them the run got to, never the posting or the document.
 */
export const tailorFromJob = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sourceResumeId: z.uuid(),
      jobText: z.string().max(MAX_JOB_CHARS),
      sourceUrl: z.string().max(2000).optional(),
    })
  )
  .handler(
    serve(async ({ services, log, data }) => {
      const startedAt = Date.now()
      try {
        const result = await services.tailor.tailorFromJob(data)
        log.info("tailor_finished", {
          resumeId: result.resume.id,
          jobTargetId: result.jobTargetId,
          tailored: result.tailored,
          model: result.model ?? undefined,
          charCount: data.jobText.length,
          latencyMs: Date.now() - startedAt,
        })
        return result
      } catch (error) {
        log.warn("tailor_failed", {
          errorClass: errorClassOf(error),
          charCount: data.jobText.length,
          latencyMs: Date.now() - startedAt,
        })
        throw error
      }
    })
  )
