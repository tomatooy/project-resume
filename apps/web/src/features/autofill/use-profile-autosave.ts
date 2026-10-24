import { useQueryClient } from "@tanstack/react-query"
import { type Profile, ProfileSchema } from "@workspace/autofill"
import type { ProfileState } from "@workspace/resume-core"
import { useCallback, useRef, useState } from "react"

import { AutoSaver, type SaveResult } from "@/features/resume/auto-saver"
import { saveAutofillProfile } from "@/lib/api"
import { autofillProfileQuery } from "@/lib/queries"
import { ApiError } from "@/lib/types"

import { useSaverLifecycle } from "./use-saver-lifecycle"

export const CONFLICT_NOTICE =
  "This page changed somewhere else. We loaded the latest version."

/**
 * One autosave write of the Profile. A stale revision is the one failure a
 * retry cannot fix, so it stops the saver and asks for the latest version;
 * anything else is retried with backoff.
 */
export function profileWriter(deps: {
  read: () => { profile: Profile; revision: number }
  save: (input: {
    profile: Profile
    expectedRevision: number
  }) => Promise<{ revision: number; updatedAt: string }>
  onSaved: (revision: number) => void
  onConflict: () => void
}): () => Promise<SaveResult> {
  return async () => {
    const { profile, revision } = deps.read()
    try {
      const saved = await deps.save({ profile, expectedRevision: revision })
      deps.onSaved(saved.revision)
      return "ok"
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        deps.onConflict()
        return "conflict"
      }
      return "retry"
    }
  }
}

export type ProfileAutosave = {
  profile: Profile
  update(next: Profile | ((current: Profile) => Profile)): void
  /** Set after a conflict reloaded the page; cleared by the next edit. */
  notice: string | null
}

/**
 * The Profile being edited, written back 800 ms after the last change.
 *
 * Only a changed Profile the schema accepts is written, so a half-typed email
 * waits for the rest of it. A pending edit is written when the page closes,
 * and each save also lands in the query cache, so the next visit starts from
 * the revision the server holds rather than a conflict.
 */
export function useProfileAutosave(state: ProfileState): ProfileAutosave {
  const client = useQueryClient()
  const [profile, setProfile] = useState(state.profile)
  const [notice, setNotice] = useState<string | null>(null)
  // The saver's view, kept outside React so a write sees the latest edit and
  // the revision it last saved without waiting for a render.
  const doc = useRef({
    profile: state.profile,
    saved: state.profile,
    revision: state.revision,
  })

  const [saver] = useState(() => {
    let writing = doc.current.profile
    return new AutoSaver({
      shouldWrite: () =>
        doc.current.profile !== doc.current.saved &&
        ProfileSchema.safeParse(doc.current.profile).success,
      write: profileWriter({
        read: () => {
          writing = doc.current.profile
          return { profile: writing, revision: doc.current.revision }
        },
        save: async (input) => {
          const saved = await saveAutofillProfile(input)
          client.setQueryData(autofillProfileQuery().queryKey, {
            profile: input.profile,
            revision: saved.revision,
            updatedAt: saved.updatedAt,
            exists: true,
          })
          return saved
        },
        onSaved: (revision) => {
          doc.current = { ...doc.current, saved: writing, revision }
        },
        onConflict: () => {
          client
            .fetchQuery({ ...autofillProfileQuery(), staleTime: 0 })
            .then((latest) => {
              doc.current = {
                profile: latest.profile,
                saved: latest.profile,
                revision: latest.revision,
              }
              setProfile(latest.profile)
              setNotice(CONFLICT_NOTICE)
            })
            .catch(() => {
              // Still stale: the next edit conflicts and asks again.
            })
        },
      }),
    })
  })

  useSaverLifecycle(saver, () => doc.current.profile !== doc.current.saved)

  const update = useCallback(
    (next: Profile | ((current: Profile) => Profile)) => {
      const profile =
        typeof next === "function" ? next(doc.current.profile) : next
      doc.current = { ...doc.current, profile }
      setProfile(profile)
      setNotice(null)
      saver.schedule()
    },
    [saver]
  )

  return { profile, update, notice }
}
