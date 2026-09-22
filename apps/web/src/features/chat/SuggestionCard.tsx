// biome-ignore-all lint/a11y/noStaticElementInteractions: the suggestion
// card previews its own effect in the PDF on hover and on focus. The card
// is not activatable and takes no role; Accept and Reject are its
// controls, and the focus handlers mirror hover for keyboard users.

import { CheckIcon, MinusIcon, PlusIcon, XIcon } from "@phosphor-icons/react"
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
import type { ReactNode } from "react"

import { MessageMarkdown } from "./MessageMarkdown"

import { useSkillNames } from "@/lib/queries"
import type { Suggestion, SuggestionStatus } from "@/lib/types"

const STATUS_LABEL: Record<Exclude<SuggestionStatus, "pending">, string> = {
  accepted: "Accepted",
  rejected: "Rejected",
  stale: "Outdated",
}

export function SuggestionCard({
  suggestion,
  resume,
  onAccept,
  onReject,
  onHover,
  busy,
  navigation,
}: {
  suggestion: Suggestion
  resume: Resume
  onAccept: () => void
  onReject: () => void
  onHover: (hovering: boolean) => void
  busy: boolean
  navigation?: ReactNode
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
        "min-w-0 rounded-xl border bg-card transition-colors",
        structural && pending ? "border-destructive/30" : "border-border"
      )}
    >
      <div className="flex min-h-12 items-center justify-between gap-2 border-b border-border px-3.5 py-2">
        <h3 className="text-[13px] font-semibold text-foreground">
          Suggested change
        </h3>
        {navigation}
      </div>

      <div className="space-y-3 p-3.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted-foreground">
          <p
            className={cn(
              "min-w-0 flex-1 wrap-break-word",
              structural && "text-destructive"
            )}
          >
            {structural
              ? structuralVerb(patch, resume)
              : breadcrumb(resume, target)}
          </p>
          {!pending ? (
            <span className="rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {STATUS_LABEL[status]}
            </span>
          ) : null}
        </div>

        <PatchBody patch={patch} resume={resume} />

        {structural && pending ? (
          <p className="mt-2 text-[11px] text-destructive/80">
            This changes the shape of the resume, so it is left out of Accept
            all.
          </p>
        ) : null}

        {estimates.length > 0 && pending ? (
          <p className="mt-2 text-[11px] text-warning">
            Not in the resume: {estimates.slice(0, 4).join(", ")}
            {estimates.length > 4 ? ` and ${estimates.length - 4} more` : ""}.
            Confirm before accepting.
          </p>
        ) : null}

        {pending ? (
          <div className="grid grid-cols-2 gap-2">
            <Button className="h-9" onClick={onAccept} disabled={busy}>
              <CheckIcon />
              Accept
            </Button>
            <Button
              variant="outline"
              className="h-9"
              onClick={onReject}
              disabled={busy}
            >
              <XIcon />
              Reject
            </Button>
          </div>
        ) : status === "stale" ? (
          <p className="mt-2 text-[11px] text-warning">
            The text changed after this was drafted, so it can no longer be
            applied.
          </p>
        ) : null}
        <div className="space-y-1.5 border-t border-border pt-3">
          <p className="text-[12px] font-semibold text-foreground">
            Why this is better
          </p>
          <div className="text-[12px] leading-relaxed text-muted-foreground">
            <MessageMarkdown>{patch.reason}</MessageMarkdown>
          </div>
          {skillName ? (
            <p className="text-[10.5px] text-muted-foreground">{skillName}</p>
          ) : null}
        </div>
      </div>
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
    return (
      <div className="space-y-3">
        <ChangeBlock label="Original" removed>
          {patch.before}
        </ChangeBlock>
        <ChangeBlock label="Suggested">{patch.after}</ChangeBlock>
      </div>
    )
  }

  if (patch.op === "update_fields") {
    return (
      <div className="space-y-3">
        <ChangeBlock label="Original" removed>
          <FieldValues values={patch.before} />
        </ChangeBlock>
        <ChangeBlock label="Suggested">
          <FieldValues values={patch.after} />
        </ChangeBlock>
      </div>
    )
  }

  if (patch.op === "delete") {
    return (
      <ChangeBlock label="Original" removed>
        {nodeSummary(patch.before)}
      </ChangeBlock>
    )
  }

  if (patch.op === "insert_after") {
    return (
      <ChangeBlock label="Suggested">{nodeSummary(patch.node)}</ChangeBlock>
    )
  }

  return (
    <ChangeBlock label="Suggested">
      Move to position {patch.toIndex + 1} within{" "}
      {patch.toParentId
        ? containerName(resume, patch.toParentId)
        : (breadcrumb(resume, patch.targetNodeId).split(" > ").at(-2) ??
          "its section")}
      .
    </ChangeBlock>
  )
}

function ChangeBlock({
  label,
  removed = false,
  children,
}: {
  label: string
  removed?: boolean
  children: ReactNode
}) {
  const Icon = removed ? MinusIcon : PlusIcon
  return (
    <div className="space-y-1.5">
      <p className="text-[12px] font-medium text-foreground">{label}</p>
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg p-2.5 text-[12.5px] leading-relaxed",
          removed
            ? "bg-destructive/10 text-destructive"
            : "bg-success/15 text-success"
        )}
      >
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <div
          className={cn(
            "min-w-0 flex-1 whitespace-pre-wrap break-words",
            removed && "line-through decoration-current"
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function FieldValues({
  values,
}: {
  values: Extract<ResumePatch, { op: "update_fields" }>["after"]
}) {
  return (
    <dl className="space-y-1">
      {Object.entries(values).map(([key, value]) => (
        <div key={key}>
          <dt className="font-medium">{key}</dt>
          <dd>
            {value === null
              ? "Not set"
              : typeof value === "object"
                ? JSON.stringify(value)
                : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}
