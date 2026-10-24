import { useEffect, useRef, useState } from "react"
import { LIMITS, type ProfileSection } from "@workspace/autofill/fields"
import { type DiffLine, PROFILE_FIELDS } from "@workspace/autofill/notes"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  likelyOnly,
  NOTES_FULL,
  NOTES_RESTORED,
  notesLine,
  onThisPage,
  optionsText,
  profileHint,
  QUESTIONS_HELP,
  questionsTitle,
  SET_IN_PROFILE,
  UNDO_REFUSED,
  UNMATCHED,
} from "../../lib/autofill-copy"
import type { AutofillAction, AutofillView } from "../../lib/autofill-view"

type Act = (action: AutofillAction) => void

/** Saves the answer box 500 ms after typing stops; a saved answer clears it. */
function useDraft(saved: string, onAction: Act) {
  const [text, setText] = useState(saved)
  const sent = useRef(saved)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const act = useRef(onAction)
  useEffect(() => {
    act.current = onAction
  }, [onAction])
  useEffect(() => {
    // A change that did not come from this box, such as a saved answer.
    if (saved === sent.current) return
    sent.current = saved
    setText(saved)
  }, [saved])
  useEffect(() => {
    if (text === sent.current) return
    timer.current = setTimeout(() => {
      sent.current = text
      act.current({ kind: "draft", text })
    }, 500)
    return () => clearTimeout(timer.current)
  }, [text])
  /** Saves now, so the answer and the stored draft agree. */
  const flush = () => {
    clearTimeout(timer.current)
    if (text === sent.current) return
    sent.current = text
    act.current({ kind: "draft", text })
  }
  return { text, setText, flush }
}

/** Diff lines with keys that survive repeated lines. */
function keyed(lines: DiffLine[]) {
  const seen = new Map<string, number>()
  return lines.map((line) => {
    const base = `${line.kind}:${line.text}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { ...line, key: `${base}:${n}` }
  })
}

function NotesResult({
  notes,
  disabled,
  onAction,
  onOpenProfile,
}: {
  notes: NonNullable<AutofillView["notes"]>
  disabled: boolean
  onAction: Act
  onOpenProfile: (section: ProfileSection) => void
}) {
  const [review, setReview] = useState(false)
  const { outcome } = notes
  const hints = outcome.kind === "failed" ? [] : outcome.hints
  const changed =
    outcome.kind === "saved" &&
    outcome.added + outcome.changed + outcome.deleted > 0
  return (
    <div className="space-y-2 text-sm">
      {outcome.kind === "full" ? (
        <Button
          variant="link"
          className="h-auto whitespace-normal p-0 text-left"
          onClick={() => onOpenProfile("notes")}
        >
          {NOTES_FULL}
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span>{notesLine(outcome)}</span>
          {changed && (
            <Button
              size="xs"
              variant="ghost"
              aria-expanded={review}
              onClick={() => setReview(!review)}
            >
              Review
            </Button>
          )}
          {changed &&
            notes.undo === null &&
            outcome.kind === "saved" &&
            outcome.undoVersionId !== null && (
              <Button
                size="xs"
                variant="ghost"
                disabled={disabled}
                onClick={() => onAction({ kind: "undo-notes" })}
              >
                Undo
              </Button>
            )}
          {outcome.kind === "failed" && notes.canRetry && (
            <Button
              size="xs"
              variant="outline"
              disabled={disabled}
              onClick={() => onAction({ kind: "retry-notes" })}
            >
              Retry
            </Button>
          )}
        </div>
      )}
      {notes.undo === "done" && <p>{NOTES_RESTORED}</p>}
      {notes.undo === "refused" && <p>{UNDO_REFUSED}</p>}
      {review && outcome.kind === "saved" && (
        <div className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs">
          {keyed(outcome.diff).map((line) => (
            <div
              key={line.key}
              className={
                line.kind === "add"
                  ? "text-success"
                  : line.kind === "remove"
                    ? "text-destructive line-through"
                    : "text-muted-foreground"
              }
            >
              {line.kind === "add"
                ? "+ "
                : line.kind === "remove"
                  ? "- "
                  : "  "}
              {line.text}
            </div>
          ))}
        </div>
      )}
      {hints.map((key) => (
        <p key={key}>
          {profileHint(PROFILE_FIELDS[key].label)}{" "}
          <Button
            size="xs"
            variant="link"
            className="h-auto p-0"
            onClick={() => onOpenProfile(PROFILE_FIELDS[key].anchor)}
          >
            {SET_IN_PROFILE}
          </Button>
        </p>
      ))}
    </div>
  )
}

/**
 * Questions for you (spec 6.4): the list, the answer box and the Notes
 * result. The box keeps its text at the limit; only the button is disabled.
 */
export function Questions({
  view,
  disabled,
  limited,
  saving,
  onAction,
  onOpenProfile,
}: {
  view: AutofillView
  disabled: boolean
  limited: boolean
  saving: boolean
  onAction: Act
  onOpenProfile: (section: ProfileSection) => void
}) {
  const draft = useDraft(view.draft, onAction)
  // Already in answer order (`openQuestions`), so the numbers match a reply.
  const { questions } = view
  const canSave =
    !disabled && !limited && view.ran && draft.text.trim().length > 0
  if (questions.length === 0 && !view.notes) return null
  return (
    <section className="space-y-3">
      {questions.length > 0 && (
        <>
          <h2 className="font-medium text-sm">
            {questionsTitle(questions.length)}
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {questions.map((question) => (
              <li key={question.id}>
                <span>
                  {question.text}
                  {question.options && question.options.length > 0
                    ? ` ${optionsText(question.options)}`
                    : ""}
                </span>
                {question.companySpecific && (
                  <span className="ml-2 text-muted-foreground text-xs">
                    {likelyOnly(view.company)}
                  </span>
                )}
                {question.original
                  .filter(({ label }) => label !== question.text)
                  .map(({ fieldId, label }) => (
                    <span
                      key={fieldId}
                      className="block text-muted-foreground text-xs"
                    >
                      {onThisPage(label)}
                    </span>
                  ))}
                {question.unmatched && (
                  <span className="block text-warning text-xs">
                    {UNMATCHED}
                  </span>
                )}
              </li>
            ))}
          </ol>
          <p className="text-xs">{QUESTIONS_HELP}</p>
          <Textarea
            aria-label="Your answers"
            className="min-h-32"
            maxLength={LIMITS.answer}
            value={draft.text}
            onChange={(event) => draft.setText(event.target.value)}
          />
          <div className="flex justify-end">
            <Button
              disabled={!canSave}
              onClick={() => {
                draft.flush()
                onAction({ kind: "answer", text: draft.text })
              }}
            >
              {saving && <Spinner />}
              Save and fill again
            </Button>
          </div>
        </>
      )}
      {view.notes && (
        <NotesResult
          notes={view.notes}
          disabled={disabled}
          onAction={onAction}
          onOpenProfile={onOpenProfile}
        />
      )}
    </section>
  )
}
