import { useId, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  displayOfSavedValue,
  type SavedAnswer,
  type SavedQuestionEvidence,
} from "@workspace/resume-core"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@workspace/ui/components/select"
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
  savedAnswersQuery,
  useRemoveSavedAnswer,
  useSaveSavedAnswer,
} from "@/lib/queries"
import { ApiError } from "@/lib/types"

/**
 * The kinds a kept answer can be. The rest are answered on the page and only
 * there: a choice depends on the options a page offers, a file on the page's
 * own upload, and a record group on the form's history section.
 */
const KINDS = [
  { value: "short_text", label: "Short answer" },
  { value: "long_text", label: "Long answer" },
  { value: "url", label: "Link" },
  { value: "yes_no", label: "Yes or no" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "month", label: "Month" },
] as const

type SavableKind = (typeof KINDS)[number]["value"]

/**
 * Both types come from the exported schemas rather than being named here, so
 * the account surface cannot drift from what the service actually accepts.
 */
type AnswerValue = SavedAnswer["value"]
type ScopeEntry = SavedQuestionEvidence["scope"][number]
type ScopeDimension = ScopeEntry["dimension"]

const DIMENSIONS: { value: ScopeDimension; label: string }[] = [
  { value: "country", label: "Country" },
  { value: "employer", label: "Employer" },
  { value: "role", label: "Role" },
  { value: "time", label: "Time" },
  { value: "currency", label: "Currency" },
  { value: "period", label: "Pay period" },
  { value: "other", label: "Something else" },
]

const dimensionLabels: Record<string, string> = Object.fromEntries(
  DIMENSIONS.map((entry) => [entry.value, entry.label])
)

/**
 * A condition row in the form. It carries an identity of its own so adding and
 * removing rows cannot renumber a row the browser already rendered.
 */
type ScopeRow = { id: string; dimension: ScopeDimension; value: string }

type Draft = {
  wording: string
  kind: SavableKind
  answer: string
  scope: ScopeRow[]
}

let scopeRowCount = 0
function scopeRow(dimension: ScopeDimension, value: string): ScopeRow {
  scopeRowCount += 1
  return { id: `scope-${scopeRowCount}`, dimension, value }
}

function emptyDraft(): Draft {
  return {
    wording: "",
    kind: "short_text",
    answer: "",
    scope: [scopeRow("employer", "")],
  }
}

/** The typed value the protocol carries, or a refusal to build one. */
function draftValue(draft: Draft): AnswerValue | null {
  const answer = draft.answer.trim()
  if (!answer) return null
  if (draft.kind === "yes_no")
    return answer === "yes" || answer === "no"
      ? { type: "boolean", state: answer }
      : null
  if (draft.kind === "number") {
    const number = Number(answer)
    return Number.isFinite(number) ? { type: "number", number } : null
  }
  if (draft.kind === "date" || draft.kind === "month") {
    const [year, month, day] = answer.split("-")
    if (!year || !/^\d{4}$/.test(year)) return null
    const monthNumber = month === undefined ? null : Number(month)
    const dayNumber =
      draft.kind === "date" && day !== undefined ? Number(day) : null
    if (monthNumber !== null && !(monthNumber >= 1 && monthNumber <= 12))
      return null
    if (dayNumber !== null && !(dayNumber >= 1 && dayNumber <= 31)) return null
    return {
      type: "date",
      year: Number(year),
      month: monthNumber,
      day: dayNumber,
    }
  }
  return { type: "text", text: answer }
}

export function SavedQuestionAnswers({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <section className="space-y-4" aria-labelledby={id}>
      <div className="space-y-2">
        <h2 id={id} className="text-base font-semibold">
          Answers kept for reuse
        </h2>
        <p className="text-sm text-muted-foreground">
          An answer kept here is recognised by the question that was actually
          asked, so a company-specific question works without anyone adding it
          to a list first. Nothing is reused unless the question's wording and
          scope both match.
        </p>
        <Button
          variant="outline"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide kept answers" : "Manage kept answers"}
        </Button>
      </div>
      {open ? <SavedQuestionList userId={userId} /> : null}
    </section>
  )
}

function SavedQuestionList({ userId }: { userId: string }) {
  const query = useQuery(savedAnswersQuery(userId))
  const remove = useRemoveSavedAnswer(userId)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<SavedAnswer | null>(null)
  const [target, setTarget] = useState<SavedAnswer | null>(null)
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
          Loading kept answers…
        </p>
      ) : null}
      {query.error ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>Could not load your kept answers.</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {query.data?.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">
          Nothing kept yet. Keep an answer to a question you have been asked
          before, and it will be reused where the same question appears.
        </p>
      ) : null}
      {query.data?.map((answer) =>
        editing?.id === answer.id ? (
          <SavedQuestionForm
            key={answer.id}
            userId={userId}
            editing={answer}
            done={() => setEditing(null)}
          />
        ) : (
          <SavedQuestionCard
            key={answer.id}
            answer={answer}
            onEdit={() => {
              setAdding(false)
              setEditing(answer)
            }}
            onRemove={() => {
              remove.reset()
              setTarget(answer)
            }}
          />
        )
      )}
      {adding ? (
        <SavedQuestionForm userId={userId} done={() => setAdding(false)} />
      ) : (
        <Button
          variant="outline"
          disabled={editing !== null}
          onClick={() => {
            remove.reset()
            setAdding(true)
          }}
        >
          Add a kept answer
        </Button>
      )}
      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this kept answer?</AlertDialogTitle>
            <AlertDialogDescription>
              Applications started later will stop recognising this question.
              Values already filled on a page do not change.
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
              {remove.isPending ? "Removing…" : "Remove kept answer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SavedQuestionCard({
  answer,
  onEdit,
  onRemove,
}: {
  answer: SavedAnswer
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <article className="space-y-3 rounded-lg border border-border p-4">
      <h3 className="whitespace-pre-wrap break-words font-medium">
        {answer.question.text}
      </h3>
      <p className="whitespace-pre-wrap break-words text-sm">
        {displayOfSavedValue(answer.value)}
      </p>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Reused only where the question and all of these match:</p>
        <dl className="flex flex-wrap gap-x-4 gap-y-1">
          {answer.question.scope.map((entry) => (
            <div
              key={`${entry.dimension}:${entry.value}`}
              className="flex gap-1"
            >
              <dt>{dimensionLabels[entry.dimension] ?? entry.dimension}:</dt>
              <dd className="break-all">{entry.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onEdit}>
          Edit answer
        </Button>
        <Button variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </article>
  )
}

function SavedQuestionForm({
  userId,
  editing,
  done,
}: {
  userId: string
  editing?: SavedAnswer
  done: () => void
}) {
  const save = useSaveSavedAnswer(userId)
  const [draft, setDraft] = useState<Draft>(() =>
    editing
      ? {
          wording: editing.question.text,
          kind: editing.question.kind as SavableKind,
          answer: draftAnswerText(editing.value),
          scope: editing.question.scope.map((entry) =>
            scopeRow(entry.dimension, entry.value)
          ),
        }
      : emptyDraft()
  )
  const id = useId()
  const conflict =
    save.error instanceof ApiError && save.error.code === "CONFLICT"
  const value = draftValue(draft)
  const scope = draft.scope.filter((row) => row.value.trim())
  const ready =
    draft.wording.trim() !== "" &&
    value !== null &&
    scope.length > 0 &&
    !save.isPending
  const submit = () => {
    if (!value) return
    save.mutate(
      {
        ...(editing ? { id: editing.id } : {}),
        expectedRevision: editing?.revision ?? 0,
        question: {
          text: draft.wording.trim(),
          kind: draft.kind,
          scope: scope.map((row) => ({
            dimension: row.dimension,
            value: row.value.trim(),
          })),
          options: [],
        },
        value,
        confirmed: true,
      },
      { onSuccess: done }
    )
  }
  return (
    <form
      className="space-y-3 rounded-lg border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <label htmlFor={`${id}-wording`} className="block space-y-1 text-sm">
        <span>The question as the page asks it</span>
        <Textarea
          id={`${id}-wording`}
          value={draft.wording}
          maxLength={2000}
          disabled={save.isPending}
          onChange={(event) =>
            setDraft({ ...draft, wording: event.target.value })
          }
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={`${id}-kind`} className="block space-y-1 text-sm">
          <span>What kind of answer it takes</span>
          <Select
            value={draft.kind}
            onValueChange={(kind) => {
              if (kind !== null)
                setDraft({ ...draft, kind: kind as SavableKind, answer: "" })
            }}
          >
            <SelectTrigger id={`${id}-kind`} aria-label="Answer kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((kind) => (
                <SelectItem key={kind.value} value={kind.value}>
                  {kind.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label htmlFor={`${id}-answer`} className="block space-y-1 text-sm">
          <span>The answer</span>
          {draft.kind === "yes_no" ? (
            <Select
              value={draft.answer}
              onValueChange={(answer) => {
                if (answer !== null) setDraft({ ...draft, answer })
              }}
            >
              <SelectTrigger id={`${id}-answer`} aria-label="The answer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={`${id}-answer`}
              value={draft.answer}
              disabled={save.isPending}
              inputMode={draft.kind === "number" ? "decimal" : undefined}
              type={
                draft.kind === "date"
                  ? "date"
                  : draft.kind === "month"
                    ? "month"
                    : "text"
              }
              onChange={(event) =>
                setDraft({ ...draft, answer: event.target.value })
              }
            />
          )}
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm">
          Where this answer holds. It is reused only where all of these match.
        </legend>
        {draft.scope.map((row, index) => (
          <div key={row.id} className="flex flex-wrap items-end gap-2">
            <label
              className="block space-y-1 text-sm"
              htmlFor={`${id}-scope-${index}`}
            >
              <span>Condition</span>
              <Select
                value={row.dimension}
                onValueChange={(value) => {
                  const next = DIMENSIONS.find(
                    (dimension) => dimension.value === value
                  )
                  if (!next) return
                  setDraft({
                    ...draft,
                    scope: draft.scope.map((at) =>
                      at.id === row.id ? { ...at, dimension: next.value } : at
                    ),
                  })
                }}
              >
                <SelectTrigger
                  id={`${id}-scope-${index}`}
                  aria-label="Condition"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIMENSIONS.map((dimension) => (
                    <SelectItem key={dimension.value} value={dimension.value}>
                      {dimension.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label
              className="block space-y-1 text-sm"
              htmlFor={`${id}-scope-value-${index}`}
            >
              <span>Value</span>
              <Input
                id={`${id}-scope-value-${index}`}
                value={row.value}
                maxLength={200}
                disabled={save.isPending}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    scope: draft.scope.map((at) =>
                      at.id === row.id
                        ? { ...at, value: event.target.value }
                        : at
                    ),
                  })
                }
              />
            </label>
            {draft.scope.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setDraft({
                    ...draft,
                    scope: draft.scope.filter((at) => at.id !== row.id),
                  })
                }
              >
                Remove condition
              </Button>
            ) : null}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setDraft({
              ...draft,
              scope: [...draft.scope, scopeRow("country", "")],
            })
          }
        >
          Add condition
        </Button>
      </fieldset>
      {draft.kind !== "yes_no" && draft.answer.trim() !== "" && !value ? (
        <p role="alert" className="text-sm text-destructive">
          {draft.kind === "number"
            ? "Enter a number."
            : "Enter a date as year, year and month, or a full date."}
        </p>
      ) : null}
      {save.error ? (
        <p role="alert" className="text-sm text-destructive">
          {conflict
            ? "This answer changed elsewhere. Review the latest version before saving again."
            : save.error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!ready}>
          {save.isPending
            ? "Saving…"
            : editing
              ? "Save answer"
              : "Keep this answer"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={save.isPending}
          onClick={() => {
            save.reset()
            done()
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** An existing value in the form's own text, so editing starts from it. */
function draftAnswerText(value: AnswerValue): string {
  switch (value.type) {
    case "text":
      return value.text
    case "boolean":
      return value.state === "unknown" ? "" : value.state
    case "number":
      return String(value.number)
    case "money":
      return String(value.amount)
    case "date": {
      const month =
        value.month === null ? "" : `-${String(value.month).padStart(2, "0")}`
      const day =
        value.day === null ? "" : `-${String(value.day).padStart(2, "0")}`
      return `${String(value.year).padStart(4, "0")}${month}${day}`
    }
    case "choice":
      return value.optionIds.join(", ")
  }
  // A value with no text form of its own: the form starts empty rather than
  // showing something the person did not write.
  return ""
}
