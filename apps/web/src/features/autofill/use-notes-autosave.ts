import { useQueryClient } from "@tanstack/react-query"
import type { NotesState } from "@workspace/resume-core"
import { useCallback, useRef, useState } from "react"

import { AutoSaver } from "@/features/resume/auto-saver"
import { restoreAutofillNoteVersion, saveAutofillNotes } from "@/lib/api"
import { autofillNotesQuery } from "@/lib/queries"
import { ApiError } from "@/lib/types"

import { createEditSession, notesWriter } from "./notes-session"
import { CONFLICT_NOTICE } from "./use-profile-autosave"
import { useSaverLifecycle } from "./use-saver-lifecycle"

export type NotesAutosave = {
  content: string
  update(next: string): void
  /** Set after a conflict reloaded the notes; cleared by the next edit. */
  notice: string | null
  /**
   * Puts a History version back in place of the current text. "reloaded"
   * means the notes had changed elsewhere, so the latest text is shown instead.
   */
  restore(id: string): Promise<"restored" | "reloaded">
}

/**
 * The Notes being edited, written back 800 ms after the last change, the same
 * way as the Profile. Each save asks the editing session whether the server
 * should keep the text it replaces, so History can bring it back.
 */
export function useNotesAutosave(state: NotesState): NotesAutosave {
  const client = useQueryClient()
  const [content, setContent] = useState(state.content)
  const [notice, setNotice] = useState<string | null>(null)
  // The saver's view, kept outside React so a write sees the latest edit and
  // the revision it last saved without waiting for a render.
  const doc = useRef({
    content: state.content,
    saved: state.content,
    revision: state.revision,
  })

  const [notes] = useState(() => {
    /** Shows text the server holds, as already saved. */
    const show = (latest: NotesState) => {
      doc.current = {
        content: latest.content,
        saved: latest.content,
        revision: latest.revision,
      }
      setContent(latest.content)
    }
    const reload = async () => {
      show(await client.fetchQuery({ ...autofillNotesQuery(), staleTime: 0 }))
      setNotice(CONFLICT_NOTICE)
    }

    let writing = doc.current.content
    const saver = new AutoSaver({
      shouldWrite: () => doc.current.content !== doc.current.saved,
      write: notesWriter({
        read: () => {
          writing = doc.current.content
          return { content: writing, revision: doc.current.revision }
        },
        save: async (input) => {
          const saved = await saveAutofillNotes(input)
          client.setQueryData(autofillNotesQuery().queryKey, {
            content: input.content,
            revision: saved.revision,
            updatedAt: saved.updatedAt,
          })
          return saved
        },
        session: createEditSession(() => Date.now()),
        onSaved: (revision) => {
          doc.current = { ...doc.current, saved: writing, revision }
        },
        onConflict: () => {
          reload().catch(() => {
            // Still stale: the next edit conflicts and asks again.
          })
        },
      }),
    })
    return { saver, show, reload }
  })

  useSaverLifecycle(
    notes.saver,
    () => doc.current.content !== doc.current.saved
  )

  const update = useCallback(
    (next: string) => {
      doc.current = { ...doc.current, content: next }
      setContent(next)
      setNotice(null)
      notes.saver.schedule()
    },
    [notes]
  )

  const restore = useCallback(
    async (id: string): Promise<"restored" | "reloaded"> => {
      // A pending edit goes in first, so the server keeps it in History
      // before the restore replaces it.
      await notes.saver.flush()
      try {
        const restored = await restoreAutofillNoteVersion({
          id,
          expectedRevision: doc.current.revision,
        })
        client.setQueryData(autofillNotesQuery().queryKey, restored)
        notes.show(restored)
        setNotice(null)
        return "restored"
      } catch (error) {
        if (error instanceof ApiError && error.code === "CONFLICT") {
          await notes.reload()
          return "reloaded"
        }
        throw error
      }
    },
    [client, notes]
  )

  return { content, update, notice, restore }
}
