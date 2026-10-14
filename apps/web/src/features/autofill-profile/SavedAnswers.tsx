import { useId, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { ScopedAnswer } from "@workspace/resume-core/contracts"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import {
  autofillAnswersQuery,
  savedAnswersReviewQuery,
  useRemoveAutofillAnswer,
  useSaveAutofillAnswer,
} from "@/lib/queries"
import { ApiError } from "@/lib/types"

const conditionLabels: Record<string, string> = {
  countryCode: "Country",
  employerId: "Employer",
  jobId: "Job",
  currency: "Currency",
  salaryPeriod: "Pay period",
}

/**
 * Why an older row is not reused. These rows carry the retired concept
 * vocabulary rather than the question's own identity, so the account surface
 * shows what each one holds and the reason it cannot be matched, and the answer
 * stays resolvable on the page that asked the question.
 */
const reviewReasons: Record<string, string> = {
  no_question_key:
    "Saved before questions had an identity of their own, so no page can recognise this question. It is not reused.",
  unsupported_value:
    "This holds a display value where the question needs a structured one, so it is not reused as it stands.",
  excluded_concept:
    "Demographic answers are never reused. They are answered on each application.",
}

function reviewReason(reason: string): string {
  return reviewReasons[reason] ?? "This answer is not reused as it stands."
}

function title(answer: ScopedAnswer): string {
  const concept = answer.meaning.concept.replaceAll("_", " ")
  return concept.charAt(0).toUpperCase() + concept.slice(1)
}

export function SavedAnswers({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <section
      className="space-y-4 border-t border-border pt-6"
      aria-labelledby={id}
    >
      <div className="space-y-2">
        <h2 id={id} className="text-base font-semibold">
          Saved answers
        </h2>
        <p className="text-sm text-muted-foreground">
          Answers you chose to reuse for matching applications. They stay
          available until you update or remove them. Applications already
          started keep their original details.
        </p>
        <Button
          variant="outline"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide saved answers" : "Manage saved answers"}
        </Button>
      </div>
      {open ? <SavedAnswersList userId={userId} /> : null}
    </section>
  )
}

function SavedAnswersList({ userId }: { userId: string }) {
  const query = useQuery(autofillAnswersQuery(userId))
  // The reasons come from the server, where the classifier lives. A row the
  // list cannot match is shown with the reason rather than hidden.
  const review = useQuery(savedAnswersReviewQuery(userId))
  const remove = useRemoveAutofillAnswer(userId)
  const [target, setTarget] = useState<ScopedAnswer | null>(null)
  const close = () => {
    if (!remove.isPending) {
      setTarget(null)
      remove.reset()
    }
  }
  return (
    <div className="space-y-4">
      {query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading saved answers…
        </p>
      ) : null}
      {query.error ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>Could not load your saved answers.</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {query.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No saved answers yet. You can choose to save an answer after
          confirming it in the extension.
        </p>
      ) : null}
      {query.data?.map((answer) => (
        <SavedAnswerCard
          key={answer.id}
          answer={answer}
          reason={
            review.data?.find((entry) => entry.answerId === answer.id)
              ?.reason ?? null
          }
          userId={userId}
          remove={() => {
            remove.reset()
            setTarget(answer)
          }}
        />
      ))}
      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this saved answer?</AlertDialogTitle>
            <AlertDialogDescription>
              Future applications will stop reusing this answer. This does not
              change values already filled on a page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {remove.error ? (
            <p role="alert" className="text-sm text-destructive">
              {remove.error.message} Close this dialog to review the latest
              answer.
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending || Boolean(remove.error)}
              onClick={() => {
                if (!target) return
                remove.mutate(
                  { id: target.id, expectedRevision: target.revision },
                  { onSuccess: () => setTarget(null) }
                )
              }}
            >
              {remove.isPending ? "Removing…" : "Remove saved answer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SavedAnswerCard({
  answer,
  reason,
  userId,
  remove,
}: {
  answer: ScopedAnswer
  reason: string | null
  userId: string
  remove: () => void
}) {
  const save = useSaveAutofillAnswer(userId)
  const [editing, setEditing] = useState<{
    base: ScopedAnswer
    value: string
  } | null>(null)
  const id = useId()
  const conflict =
    save.error instanceof ApiError && save.error.code === "CONFLICT"
  const latestAvailable = editing && answer.revision !== editing.base.revision
  const scopeUnchanged =
    editing &&
    JSON.stringify(editing.base.meaning) === JSON.stringify(answer.meaning) &&
    JSON.stringify(editing.base.conditions) ===
      JSON.stringify(answer.conditions)
  const displayed = editing?.base ?? answer
  return (
    <article className="space-y-3 rounded-lg border border-border p-4">
      <h3 className="font-medium">{title(displayed)}</h3>
      {reason ? (
        <p role="status" className="text-sm text-warning">
          {reviewReason(reason)}
        </p>
      ) : null}
      {displayed.meaning.questionKey ? (
        <p className="whitespace-pre-wrap break-words text-sm">
          {displayed.meaning.questionKey}
        </p>
      ) : null}
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Reuse only when all these conditions match:</p>
        <dl className="flex flex-wrap gap-x-4 gap-y-1">
          {Object.entries(displayed.conditions)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => (
              <div key={key} className="flex gap-1">
                <dt>{conditionLabels[key] ?? key}:</dt>
                <dd className="break-all">{value}</dd>
              </div>
            ))}
        </dl>
      </div>
      {editing ? (
        <div className="space-y-3">
          <label htmlFor={id} className="block space-y-1 text-sm">
            <span>Answer</span>
            <Textarea
              id={id}
              value={editing.value}
              maxLength={4000}
              disabled={save.isPending}
              onChange={(event) =>
                setEditing({ ...editing, value: event.target.value })
              }
            />
          </label>
          {save.error ? (
            <div role="alert" className="space-y-2 text-sm">
              <p className="text-destructive">
                {conflict
                  ? "This answer changed elsewhere. Your draft is preserved. Review the latest saved answer before saving again."
                  : save.error.message}
              </p>
              {conflict && latestAvailable ? (
                <>
                  <p className="font-medium">Latest saved answer</p>
                  <p className="whitespace-pre-wrap break-words">
                    {answer.value}
                  </p>
                  {scopeUnchanged ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditing({ base: answer, value: editing.value })
                        save.reset()
                      }}
                    >
                      I reviewed the latest answer, keep my draft
                    </Button>
                  ) : (
                    <p>
                      The question or reuse conditions also changed. Discard
                      these edits to review the updated answer.
                    </p>
                  )}
                </>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Saving confirms this answer for the conditions shown above.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={save.isPending || conflict || !editing.value.trim()}
              onClick={() =>
                save.mutate(
                  {
                    id: editing.base.id,
                    expectedRevision: editing.base.revision,
                    meaning: editing.base.meaning,
                    conditions: editing.base.conditions,
                    value: editing.value,
                    provenance: { kind: "user" },
                    confirmed: true,
                  },
                  { onSuccess: () => setEditing(null) }
                )
              }
            >
              {save.isPending ? "Saving…" : "Confirm and save answer"}
            </Button>
            <Button
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setEditing(null)
                save.reset()
              }}
            >
              Discard edits
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap break-words text-sm">
            {answer.value}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                save.reset()
                setEditing({ base: answer, value: answer.value })
              }}
            >
              Edit answer
            </Button>
            <Button variant="ghost" onClick={remove}>
              Remove
            </Button>
          </div>
        </>
      )}
    </article>
  )
}
