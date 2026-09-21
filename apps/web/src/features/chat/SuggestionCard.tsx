// biome-ignore-all lint/a11y/noStaticElementInteractions: the suggestion
// card previews its own effect in the PDF on hover and on focus. The card
// is not activatable and takes no role; Accept and Dismiss are its
// controls, and the focus handlers mirror hover for keyboard users.

import {
  addedFigures,
  breadcrumb,
  nodeSummary,
  ROOT_PARENT,
  type Resume,
  type ResumePatch,
  structuralReason,
} from "@workspace/resume-schema"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { MessageMarkdown } from "./MessageMarkdown"

import { useSkillNames } from "@/lib/queries"
import type { Suggestion, SuggestionStatus } from "@/lib/types"
import { WordDiff } from "@/lib/word-diff"

const STATUS_LABEL: Record<Exclude<SuggestionStatus, "pending">, string> = {
  accepted: "Accepted",
  rejected: "Dismissed",
  stale: "Outdated",
}

export function SuggestionCard({
  suggestion,
  resume,
  onAccept,
  onReject,
  onHover,
  busy,
}: {
  suggestion: Suggestion
  resume: Resume
  onAccept: () => void
  onReject: () => void
  onHover: (hovering: boolean) => void
  busy: boolean
}) {
  const { patch, status } = suggestion
  const pending = status === "pending"
  const names = useSkillNames()
  // Attribution only: a patch the model left untagged, or one the editor built
  // by hand, simply has no playbook named on it. A removed skill keeps its
  // name here, because that is the row the list kept it for.
  const skillName = patch.skillId ? names[patch.skillId] : undefined
  // Recomputed here from the same function the server gates on, so a card is
  // never dressed as ordinary while the server would refuse it as structural.
  const structural = structuralReason(resume, patch)
  // The figures this patch writes that the resume does not already state. No
  // count is sent to the model and nothing is refused for it: the note is the
  // user's, and it exists because a number they cannot defend in an interview
  // costs more than the bullet gains.
  const estimates = addedFigures(resume, patch)
  const target = "targetNodeId" in patch ? patch.targetNodeId : patch.parentId

  return (
    <div
      onMouseEnter={() => pending && onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => pending && onHover(true)}
      onBlur={() => onHover(false)}
      className={cn(
        "rounded-lg border p-3 transition-colors",
        pending
          ? structural
            ? "border-destructive/30 bg-destructive/5"
            : "border-primary/28 bg-primary/5"
          : "border-border bg-canvas opacity-80"
      )}
    >
      <div className="mb-2 flex items-center gap-1.5">
        {pending ? (
          <span
            className={cn(
              "size-[5px] animate-soft-pulse rounded-full",
              structural ? "bg-destructive" : "bg-primary"
            )}
          />
        ) : null}
        <span
          className={cn(
            "text-[10.5px] font-bold tracking-[0.05em] uppercase",
            structural ? "text-destructive" : "text-primary-strong"
          )}
        >
          {structural ? structuralVerb(patch, resume) : OP_LABEL[patch.op]}
        </span>
        {skillName ? (
          <span className="text-[10.5px] text-muted-foreground">
            {skillName}
          </span>
        ) : null}
        <div className="flex-1" />
        {!pending ? (
          <span className="rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {STATUS_LABEL[status]}
          </span>
        ) : null}
      </div>

      {/* A structural verb already names where it lands, so the breadcrumb
          under it would only repeat the words back. */}
      {structural ? null : (
        <p className="mb-2 truncate text-[10.5px] text-muted-foreground">
          {breadcrumb(resume, target)}
        </p>
      )}

      <PatchBody patch={patch} resume={resume} />

      <div className="mt-2 text-[11.5px] leading-[1.5] text-muted-foreground">
        <MessageMarkdown>{patch.reason}</MessageMarkdown>
      </div>

      {structural && pending ? (
        <p className="mt-2 text-[11px] text-destructive/80">
          This changes the shape of the resume, so it is left out of Accept all.
        </p>
      ) : null}

      {estimates.length > 0 && pending ? (
        <p className="mt-2 text-[11px] text-flag-foreground">
          Not in the resume: {estimates.slice(0, 4).join(", ")}
          {estimates.length > 4 ? ` and ${estimates.length - 4} more` : ""}.
          Confirm before accepting.
        </p>
      ) : null}

      {pending ? (
        <div className="mt-3 flex gap-[7px]">
          <Button size="sm" onClick={onAccept} disabled={busy}>
            Accept
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onReject}
            disabled={busy}
          >
            Dismiss
          </Button>
        </div>
      ) : status === "stale" ? (
        <p className="mt-2 text-[11px] text-flag-foreground">
          The text changed after this was drafted, so it can no longer be
          applied.
        </p>
      ) : null}
    </div>
  )
}

const OP_LABEL: Record<ResumePatch["op"], string> = {
  replace_text: "Suggested rewrite",
  update_fields: "Suggested change",
  insert_after: "Suggested addition",
  delete: "Suggested removal",
  move: "Suggested reorder",
}

/**
 * The verb a structural card leads with, naming what it acts on: "Remove
 * Experience > University of Georgia". A content card can stay generic
 * because the breadcrumb under it says where it lands; a structural one has
 * to be unmistakable at a glance.
 */
function structuralVerb(patch: ResumePatch, resume: Resume): string {
  if (patch.op === "delete") {
    return `Remove ${breadcrumb(resume, patch.targetNodeId)}`
  }
  if (patch.op === "move") {
    return `Move ${breadcrumb(resume, patch.targetNodeId)} to ${containerName(
      resume,
      patch.toParentId ?? ROOT_PARENT
    )}`
  }
  if (patch.op === "insert_after") {
    return `Add to ${containerName(resume, patch.parentId)}`
  }
  return OP_LABEL[patch.op]
}

function containerName(resume: Resume, parentId: string): string {
  if (parentId === ROOT_PARENT) return "the top level"
  return breadcrumb(resume, parentId).split(" > ").at(-1) ?? parentId
}

function PatchBody({ patch, resume }: { patch: ResumePatch; resume: Resume }) {
  if (patch.op === "replace_text") {
    return <WordDiff before={patch.before} after={patch.after} />
  }

  if (patch.op === "update_fields") {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        {Object.entries(patch.after).map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="min-w-0 truncate font-medium">
              {value === null ? "cleared" : String(value)}
            </dd>
          </div>
        ))}
      </dl>
    )
  }

  if (patch.op === "delete") {
    return (
      <p className="text-[12px] leading-[1.5] text-muted-foreground line-through decoration-border">
        {nodeSummary(patch.before)}
      </p>
    )
  }

  if (patch.op === "insert_after") {
    return (
      <p className="text-[12.5px] leading-[1.55] font-medium">
        {nodeSummary(patch.node)}
      </p>
    )
  }

  return (
    <p className="text-[12px] text-muted-foreground">
      Move to position {patch.toIndex + 1} within{" "}
      {breadcrumb(resume, patch.targetNodeId).split(" > ").at(-2) ??
        "its section"}
      .
    </p>
  )
}
