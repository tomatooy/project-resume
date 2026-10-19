import { NOTES_LIMIT, NOTES_WARN } from "@workspace/autofill"
import type { NotesState } from "@workspace/resume-core"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import { useId } from "react"

import { NotesHistory } from "./NotesHistory"
import { notesCount } from "./notes-session"
import { useNotesAutosave } from "./use-notes-autosave"

const WARNING = "Notes are almost full. Clean up facts you no longer need."
const PLACEHOLDER =
  "## Work style\n- Prefers remote work\n\n## Logistics\n- Can start two weeks after an offer"

/** The Notes text, saved as it is typed, with its count and History. */
export function NotesEditor({ state }: { state: NotesState }) {
  const notes = useNotesAutosave(state)
  const warningId = useId()
  const full = notes.content.length >= NOTES_WARN
  return (
    <div>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Facts your profile and resumes don't cover, one per line. Autofill adds
        to them when you answer new questions on an application.
      </p>
      <div role="status">
        {notes.notice ? (
          <p className="mt-3 rounded-[10px] border border-border bg-background px-3.5 py-2.5 text-[12px] shadow-sm">
            {notes.notice}
          </p>
        ) : null}
      </div>
      <Textarea
        aria-label="Notes"
        aria-describedby={full ? warningId : undefined}
        value={notes.content}
        maxLength={NOTES_LIMIT}
        onChange={(event) => notes.update(event.target.value)}
        placeholder={PLACEHOLDER}
        className="mt-3 max-h-[60vh] min-h-56 leading-relaxed"
      />
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span
          className={cn(
            "text-[11.5px] tabular-nums",
            full ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {notesCount(notes.content.length)}
        </span>
        <NotesHistory restore={notes.restore} />
      </div>
      {full ? (
        <p id={warningId} className="text-[11.5px] text-destructive">
          {WARNING}
        </p>
      ) : null}
    </div>
  )
}
