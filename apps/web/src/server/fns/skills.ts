import { createServerFn } from "@tanstack/react-start"
import { mergeSkills } from "@workspace/agent"
import { AppError, UserSkillInputSchema } from "@workspace/resume-core"
import { z } from "zod"

import { serve } from "../handler"

const skillIdInput = z.object({ id: z.string().min(1).max(64) })

/**
 * The client's one view of the library: built-ins and the user's own rows
 * merged, in index order, with no bodies.
 *
 * `deleted` rows stay in the list on purpose. An older suggestion card can
 * name a skill the user has since removed, and this is the only place that
 * name now comes from.
 */
export const listSkills = createServerFn({ method: "GET" }).handler(
  serve(async ({ services }) => {
    const entries = mergeSkills(await services.skills.listOverlay())
    return entries.map((entry) => ({
      id: entry.skill.id,
      category: entry.skill.category,
      name: entry.skill.name,
      description: entry.skill.description,
      whenToUse: entry.skill.whenToUse,
      notFor: entry.skill.notFor,
      starter: entry.skill.starter,
      source: entry.source,
      enabled: entry.enabled,
      deleted: entry.deleted,
    }))
  })
)

/** One live custom skill, body included, for the editor. */
export const getUserSkill = createServerFn({ method: "GET" })
  .validator(skillIdInput)
  .handler(serve(({ services, data }) => services.skills.get(data.id)))

export const createUserSkill = createServerFn({ method: "POST" })
  .validator(UserSkillInputSchema)
  .handler(serve(({ services, data }) => services.skills.create(data)))

export const updateUserSkill = createServerFn({ method: "POST" })
  .validator(UserSkillInputSchema.extend({ id: z.string().min(1).max(64) }))
  .handler(serve(({ services, data }) => services.skills.update(data.id, data)))

export const deleteUserSkill = createServerFn({ method: "POST" })
  .validator(skillIdInput)
  .handler(
    serve(async ({ services, data }) => {
      await services.skills.remove(data.id)
      return { ok: true as const }
    })
  )

/**
 * Switching a skill off or back on.
 *
 * The no-FK table cannot check the id itself, so the check lives here: only an
 * id the user's own merged library holds as a live entry may be written, which
 * stops the table collecting arbitrary strings. Disabling is not "deleting",
 * so a disabled entry still counts as live and can be switched back on.
 */
export const setSkillEnabled = createServerFn({ method: "POST" })
  .validator(
    z.object({
      skillId: z.string().min(1).max(64),
      disabled: z.boolean(),
    })
  )
  .handler(
    serve(async ({ services, data }) => {
      const entries = mergeSkills(await services.skills.listOverlay())
      const live = entries.some(
        (entry) => entry.skill.id === data.skillId && !entry.deleted
      )
      if (!live) throw new AppError("VALIDATION", "Unknown skill")
      await services.skills.setDisabled(data.skillId, data.disabled)
      return { ok: true as const }
    })
  )

/**
 * Parses a `SKILL.md` and hands the fields back for the editor to prefill.
 * Nothing is saved: the user reviews the parse before it becomes a skill.
 */
export const importSkillMarkdown = createServerFn({ method: "POST" })
  .validator(z.object({ text: z.string() }))
  .handler(
    serve(async ({ services, data }) =>
      services.skills.importMarkdown(data.text)
    )
  )
