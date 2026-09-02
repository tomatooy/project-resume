import { createServerFn } from "@tanstack/react-start"
import {
  ResumeSchema,
  TemplateIdSchema,
  TemplateOptionsSchema,
} from "@workspace/resume-schema"
import type {
  HeadWrite,
  ResumeRecord,
  ResumeSummary,
} from "@workspace/resume-core"
import { z } from "zod"

import { withSupabase } from "../handler"

const idInput = z.object({ id: z.uuid() })

export const listResumes = createServerFn({ method: "GET" }).handler(
  withSupabase<undefined, ResumeSummary[]>(({ services }) =>
    services.resumes.list()
  )
)

export const getResume = createServerFn({ method: "GET" })
  .validator(idInput)
  .handler(
    withSupabase<z.infer<typeof idInput>, ResumeRecord>(({ services, data }) =>
      services.resumes.get(data.id)
    )
  )

const createInput = z.object({
  title: z.string().optional(),
  fromResumeId: z.uuid().optional(),
})

export const createResume = createServerFn({ method: "POST" })
  .validator(createInput)
  .handler(
    withSupabase<z.infer<typeof createInput>, ResumeSummary>(
      ({ services, data }) => services.resumes.create(data)
    )
  )

const updateInput = z.object({
  id: z.uuid(),
  data: ResumeSchema,
  /**
   * The optimistic-concurrency token. Omitted only by the conflict-recovery
   * overwrite, which means "take mine regardless".
   */
  expectedRevision: z.number().optional(),
})

export const updateResume = createServerFn({ method: "POST" })
  .validator(updateInput)
  .handler(
    withSupabase<z.infer<typeof updateInput>, HeadWrite>(({ services, data }) =>
      services.resumes.update(data)
    )
  )

const renameInput = z.object({ id: z.uuid(), title: z.string() })

export const renameResume = createServerFn({ method: "POST" })
  .validator(renameInput)
  .handler(
    withSupabase<z.infer<typeof renameInput>, { ok: true }>(
      async ({ services, data }) => {
        await services.resumes.rename(data.id, data.title)
        return { ok: true }
      }
    )
  )

const templateInput = z.object({
  id: z.uuid(),
  templateId: TemplateIdSchema,
  templateOptions: TemplateOptionsSchema,
})

export const setTemplate = createServerFn({ method: "POST" })
  .validator(templateInput)
  .handler(
    withSupabase<z.infer<typeof templateInput>, { ok: true }>(
      async ({ services, data }) => {
        await services.resumes.setTemplate(
          data.id,
          data.templateId,
          data.templateOptions
        )
        return { ok: true }
      }
    )
  )

export const duplicateResume = createServerFn({ method: "POST" })
  .validator(idInput)
  .handler(
    withSupabase<z.infer<typeof idInput>, ResumeSummary>(({ services, data }) =>
      services.resumes.duplicate(data.id)
    )
  )

export const deleteResume = createServerFn({ method: "POST" })
  .validator(idInput)
  .handler(
    withSupabase<z.infer<typeof idInput>, { ok: true }>(
      async ({ services, data }) => {
        await services.resumes.remove(data.id)
        return { ok: true }
      }
    )
  )
