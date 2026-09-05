import { createServerFn } from "@tanstack/react-start"
import { MAX_IMPORT_CHARS } from "@workspace/resume-core"
import { z } from "zod"

import { serve } from "../handler"
import { errorClassOf } from "../log"

/**
 * A server function rather than a route: the browser extracts the PDF's text
 * itself, so what crosses this boundary is a string, and the serializer that
 * forced the chat route to be a raw handler has no problem with it.
 *
 * The log records how big the input was and how it ended, never what it said.
 */
export const importResume = createServerFn({ method: "POST" })
  .validator(z.object({ text: z.string().max(MAX_IMPORT_CHARS) }))
  .handler(
    serve(async ({ services, log, data }) => {
      const startedAt = Date.now()
      try {
        const { resume, model } = await services.imports.import({
          text: data.text,
        })
        log.info("import_finished", {
          resumeId: resume.id,
          model,
          charCount: data.text.length,
          latencyMs: Date.now() - startedAt,
        })
        return resume
      } catch (error) {
        log.warn("import_failed", {
          errorClass: errorClassOf(error),
          charCount: data.text.length,
          latencyMs: Date.now() - startedAt,
        })
        throw error
      }
    })
  )
