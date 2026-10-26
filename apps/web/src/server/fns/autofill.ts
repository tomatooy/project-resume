import { createServerFn } from "@tanstack/react-start"
import { NOTES_LIMIT, ProfileSchema } from "@workspace/autofill"
import { z } from "zod"

import { serve } from "../handler"

const expectedRevision = z.number().int().min(0)
const versionIdInput = z.object({ id: z.uuid() })

/** The Profile, or the empty one at revision 0 before the first save. */
export const getAutofillProfile = createServerFn({ method: "GET" }).handler(
  serve("getAutofillProfile", ({ services }) => services.autofillProfile.get())
)

/** Saved whole; a revision other than the stored one is a CONFLICT. */
export const saveAutofillProfile = createServerFn({ method: "POST" })
  .validator(z.object({ profile: ProfileSchema, expectedRevision }))
  .handler(
    serve("saveAutofillProfile", ({ services, data }) =>
      services.autofillProfile.save(data)
    )
  )

export const getAutofillNotes = createServerFn({ method: "GET" }).handler(
  serve("getAutofillNotes", ({ services }) => services.autofillNotes.get())
)

/** `snapshot` marks the first save of an editing session (spec 8.3). */
export const saveAutofillNotes = createServerFn({ method: "POST" })
  .validator(
    z.object({
      content: z.string().max(NOTES_LIMIT),
      expectedRevision,
      snapshot: z.boolean(),
    })
  )
  .handler(
    serve("saveAutofillNotes", ({ services, data }) =>
      services.autofillNotes.save(data)
    )
  )

/** History: the newest 20 snapshots, without their text. */
export const listAutofillNoteVersions = createServerFn({
  method: "GET",
}).handler(
  serve("listAutofillNoteVersions", ({ services }) =>
    services.autofillNotes.versions()
  )
)

export const getAutofillNoteVersion = createServerFn({ method: "GET" })
  .validator(versionIdInput)
  .handler(
    serve("getAutofillNoteVersion", ({ services, data }) =>
      services.autofillNotes.version(data.id)
    )
  )

/** Snapshots the current Notes with reason `restore`, then writes the old text. */
export const restoreAutofillNoteVersion = createServerFn({ method: "POST" })
  .validator(versionIdInput.extend({ expectedRevision }))
  .handler(
    serve("restoreAutofillNoteVersion", ({ services, data }) =>
      services.autofillNotes.restore(data)
    )
  )
