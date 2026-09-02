import { createServerFn } from "@tanstack/react-start"
import type { Resume } from "@workspace/resume-schema"
import type { RestoreResult, VersionSummary } from "@workspace/resume-core"
import { z } from "zod"

import { withSupabase } from "../handler"

const listInput = z.object({ resumeId: z.uuid() })

export const listVersions = createServerFn({ method: "GET" })
  .validator(listInput)
  .handler(
    withSupabase<z.infer<typeof listInput>, VersionSummary[]>(
      ({ services, data }) => services.versions.list(data.resumeId)
    )
  )

const getInput = z.object({ id: z.uuid() })

export const getVersion = createServerFn({ method: "GET" })
  .validator(getInput)
  .handler(
    withSupabase<z.infer<typeof getInput>, { content: Resume }>(
      ({ services, data }) => services.versions.getContent(data.id)
    )
  )

const snapshotInput = z.object({
  resumeId: z.uuid(),
  label: z.string().optional(),
})

export const createSnapshot = createServerFn({ method: "POST" })
  .validator(snapshotInput)
  .handler(
    withSupabase<z.infer<typeof snapshotInput>, VersionSummary>(
      ({ services, data }) =>
        services.versions.snapshot(data.resumeId, {
          label: data.label,
          createdBy: "user",
        })
    )
  )

const restoreInput = z.object({
  resumeId: z.uuid(),
  versionId: z.uuid(),
})

export const restoreVersion = createServerFn({ method: "POST" })
  .validator(restoreInput)
  .handler(
    withSupabase<z.infer<typeof restoreInput>, RestoreResult>(
      ({ services, data }) =>
        services.versions.restore(data.resumeId, data.versionId)
    )
  )
