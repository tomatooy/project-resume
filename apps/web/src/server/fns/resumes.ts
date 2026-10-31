import { createServerFn } from "@tanstack/react-start"
import {
  ResumeSchema,
  TemplateIdSchema,
  TemplateOptionsSchema,
} from "@workspace/resume-schema"
import { z } from "zod"

import { serve } from "../handler"

const idInput = z.object({ id: z.uuid() })

export const searchResumes = createServerFn({ method: "POST" })
  .validator(z.object({ q: z.string().trim().min(2).max(120) }))
  .handler(
    serve("searchResumes", ({ services, data }) =>
      services.resumes.search(data.q)
    )
  )

export const getResume = createServerFn({ method: "GET" })
  .validator(idInput)
  .handler(
    serve("getResume", ({ services, data }) => services.resumes.get(data.id))
  )

export const createResume = createServerFn({ method: "POST" })
  .validator(
    z.object({
      title: z.string().optional(),
      fromResumeId: z.uuid().optional(),
    })
  )
  .handler(
    serve("createResume", ({ services, data }) => services.resumes.create(data))
  )

export const updateResume = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.uuid(),
      data: ResumeSchema,
      /**
       * The optimistic-concurrency token. Omitted only by the conflict-recovery
       * overwrite, which means "take mine regardless".
       */
      expectedRevision: z.number().optional(),
    })
  )
  .handler(
    serve("updateResume", ({ services, data }) => services.resumes.update(data))
  )

export const renameResume = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.uuid(), title: z.string() }))
  .handler(
    serve("renameResume", async ({ services, data }) => {
      await services.resumes.rename(data.id, data.title)
      return { ok: true as const }
    })
  )

export const setTemplate = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.uuid(),
      templateId: TemplateIdSchema,
      templateOptions: TemplateOptionsSchema,
    })
  )
  .handler(
    serve("setTemplate", async ({ services, data }) => {
      await services.resumes.setTemplate(
        data.id,
        data.templateId,
        data.templateOptions
      )
      return { ok: true as const }
    })
  )

export const duplicateResume = createServerFn({ method: "POST" })
  .validator(idInput)
  .handler(
    serve("duplicateResume", ({ services, data }) =>
      services.resumes.duplicate(data.id)
    )
  )

export const deleteResume = createServerFn({ method: "POST" })
  .validator(idInput)
  .handler(
    serve("deleteResume", async ({ services, data }) => {
      await services.resumes.remove(data.id)
      return { ok: true as const }
    })
  )
