import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import { serve } from "../handler"

export const listVersions = createServerFn({ method: "GET" })
  .validator(
    z.object({
      resumeId: z.uuid(),
      cursor: z.number().int().positive().optional(),
    })
  )
  .handler(
    serve(async ({ services, data, log }) => {
      const start = Date.now()
      const page = await services.versions.page(data.resumeId, data.cursor)
      log.info("versions.page", {
        count: page.items.length,
        latencyMs: Date.now() - start,
      })
      return page
    })
  )

export const getVersion = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.uuid() }))
  .handler(serve(({ services, data }) => services.versions.getContent(data.id)))

export const createSnapshot = createServerFn({ method: "POST" })
  .validator(z.object({ resumeId: z.uuid(), label: z.string().optional() }))
  .handler(
    serve(({ services, data }) =>
      services.versions.snapshot(data.resumeId, {
        label: data.label,
        createdBy: "user",
      })
    )
  )

export const restoreVersion = createServerFn({ method: "POST" })
  .validator(z.object({ resumeId: z.uuid(), versionId: z.uuid() }))
  .handler(
    serve(({ services, data }) =>
      services.versions.restore(data.resumeId, data.versionId)
    )
  )
