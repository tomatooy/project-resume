// biome-ignore-all lint/a11y/noStaticElementInteractions: the suggestion
// card previews its own effect in the PDF on hover and on focus. The card
// is not activatable and takes no role; Accept and Dismiss are its
// controls, and the focus handlers mirror hover for keyboard users.

import {
  breadcrumb,
  type Resume,
  type ResumePatch,
} from "@workspace/resume-schema"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { diffWords } from "diff"
import { useMemo } from "react"

import { skillById } from "@/lib/skills"
import type { Suggestion, SuggestionStatus } from "@/lib/types"

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
  const skill = skillById.get(patch.skillId as never)
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
          ? "border-primary/28 bg-primary/5"
          : "border-border bg-canvas opacity-80"
      )}
    >
      <div className="mb-2 flex items-center gap-1.5">
        {pending ? (
          <span className="size-[5px] animate-soft-pulse rounded-full bg-primary" />
        ) : null}
        <span className="text-[10.5px] font-bold tracking-[0.05em] text-primary-strong uppercase">
          {OP_LABEL[patch.op]}
        </span>
        {skill ? (
          <span className="text-[10.5px] text-muted-foreground">
            {skill.label}
          </span>
        ) : null}
        <div className="flex-1" />
        {!pending ? (
          <span className="rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {STATUS_LABEL[status]}
          </span>
        ) : null}
      </div>

      <p className="mb-2 truncate text-[10.5px] text-muted-foreground">
        {breadcrumb(resume, target)}
      </p>

      <PatchBody patch={patch} resume={resume} />

      <p className="mt-2 text-[11.5px] leading-[1.5] text-muted-foreground">
        {patch.reason}
      </p>

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
            <dd className="min-w-0 truncate font-medium">{String(value)}</dd>
          </div>
        ))}
      </dl>
    )
  }

  if (patch.op === "delete") {
    return (
      <p className="text-[12px] leading-[1.5] text-muted-foreground line-through decoration-border">
        {summarise(patch.before)}
      </p>
    )
  }

  if (patch.op === "insert_after") {
    return (
      <p className="text-[12.5px] leading-[1.55] font-medium">
        {summarise(patch.node)}
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

/** Word-level diff, so a small rewrite reads as a small rewrite. */
function WordDiff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffWords(before, after), [before, after])

  return (
    <p className="text-[12.5px] leading-[1.55]">
      {parts.map((part) => {
        // A diff part is uniquely identified by its marker plus its text.
        const key = `${part.added ? "+" : part.removed ? "-" : "="}${part.value}`
        if (part.added) {
          return (
            <span
              key={key}
              className="rounded-[2px] bg-primary/14 font-medium text-primary-deep"
            >
              {part.value}
            </span>
          )
        }
        if (part.removed) {
          return (
            <span
              key={key}
              className="text-muted-foreground line-through decoration-border"
            >
              {part.value}
            </span>
          )
        }
        return <span key={key}>{part.value}</span>
      })}
    </p>
  )
}

function summarise(node: unknown): string {
  if (typeof node === "string") return node
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>
    for (const key of ["text", "role", "title", "name", "school", "label"]) {
      if (typeof record[key] === "string") return record[key]
    }
  }
  return "this entry"
}
