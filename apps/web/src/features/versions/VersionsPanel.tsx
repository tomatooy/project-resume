import { LoadMore } from "@/features/shell/LoadMore"
import { ArrowUUpLeftIcon } from "@phosphor-icons/react"
import { useQuery, useInfiniteQuery } from "@tanstack/react-query"
import {
  diffDocuments,
  formatYearMonth,
  nodeSummary,
  type FieldChange,
  type NodeDiff,
} from "@workspace/resume-schema"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"
import { useStore } from "@tanstack/react-store"
import { createResumeUi } from "../workspace/store"
import { useOptionalResumeRuntime } from "../workspace/resume-runtime"
import { useTabScroll } from "../workspace/use-tab-scroll"
import { toast } from "sonner"

import { SKELETON_KEYS, pluralize, relativeTime } from "@/lib/format"
import { useRestoreVersion, versionQuery, versionsQuery } from "@/lib/queries"
import type { VersionSummary } from "@/lib/types"
import { WordDiff } from "@/lib/word-diff"
import { useResumeState, useSession } from "../resume/session-context"

const AUTHOR: Record<VersionSummary["createdBy"], string> = {
  user: "You",
  agent: "Assistant",
  system: "Automatic",
}

/**
 * Takes over the editor's form column, which is far too narrow for the two
 * columns this used to be. The diff opens under the version it belongs to
 * instead, so the pairing survives the single-column stack.
 */
export function VersionsPanel() {
  const session = useSession()
  const resumeId = useResumeState((s) => s.resumeId)
  const head = useResumeState((s) => s.doc)
  const runtime = useOptionalResumeRuntime()
  const [local] = useState(createResumeUi)
  const ui = runtime?.ui ?? local
  const selectedId = useStore(ui, (s) => s.versionId)
  const setSelectedId = (versionId: string | null) =>
    ui.setState((s) => ({ ...s, versionId }))
  const scroll = useTabScroll(`resume:${resumeId}:versions`)

  const versions = useInfiniteQuery(versionsQuery(resumeId))
  const rows = versions.data?.pages.flatMap((page) => page.items)
  const selected = useQuery({
    ...versionQuery(selectedId ?? ""),
    enabled: Boolean(selectedId),
  })
  const restore = useRestoreVersion(resumeId)

  const diff: NodeDiff[] = selected.data
    ? diffDocuments(selected.data.content, head)
    : []

  return (
    <div
      ref={scroll}
      className="min-h-0 flex-1 overflow-y-auto px-6 pt-[22px] pb-[76px]"
    >
      <h2 className="font-heading text-[19px] font-semibold tracking-[-0.015em]">
        Versions
      </h2>
      <p className="mt-1.5 mb-5 text-[12.5px] text-muted-foreground">
        A version is written when you accept a suggestion, save one by hand, or
        restore an older one. Typing alone never creates a version.
      </p>

      {versions.isPending ? (
        <div className="flex flex-col gap-2">
          {SKELETON_KEYS.slice(0, 3).map((key) => (
            <Skeleton key={key} className="h-[58px] rounded-[10px]" />
          ))}
        </div>
      ) : rows?.length === 0 ? (
        <Empty className="rounded-[10px] border border-dashed border-border py-12">
          <EmptyHeader>
            <EmptyTitle className="text-[13.5px]">No versions yet</EmptyTitle>
            <EmptyDescription className="text-[12px]">
              Use “Save version” in the editor to mark a point you can come back
              to.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows?.map((version) => {
            const active = version.id === selectedId
            return (
              <li key={version.id} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => setSelectedId(active ? null : version.id)}
                  className={cn(
                    "rounded-[10px] border bg-card p-3.5 text-left transition-colors",
                    active
                      ? "rounded-b-none border-b-0 border-primary/40 bg-primary/6"
                      : "border-border hover:border-primary/25"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-heading text-[13px] font-semibold">
                      v{version.versionNo}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">
                      {version.label}
                    </span>
                    <span className="flex-none rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {AUTHOR[version.createdBy]}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {relativeTime(version.createdAt)}
                  </div>
                </button>

                {active ? (
                  <div className="rounded-b-[10px] border border-t-0 border-primary/40 bg-card p-3.5">
                    {selected.isPending ? (
                      <Skeleton className="h-20" />
                    ) : (
                      <>
                        <div className="mb-3 flex items-center gap-2">
                          <span className="text-[10.5px] font-bold tracking-[0.05em] text-muted-foreground uppercase">
                            Changes since
                          </span>
                          <div className="flex-1" />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={restore.isPending}
                            onClick={() => {
                              void session
                                .track(
                                  (async () => {
                                    await session.flush()
                                    if (session.state.saveStatus !== "saved")
                                      throw new Error(
                                        "Save your latest edits before restoring a version."
                                      )
                                    const result = await restore.mutateAsync(
                                      version.id
                                    )
                                    session.replaceHead(
                                      result.head,
                                      result.revision,
                                      result.updatedAt
                                    )
                                    setSelectedId(null)
                                    toast.success(result.version.label)
                                  })()
                                )
                                .catch((error: Error) =>
                                  toast.error(error.message)
                                )
                            }}
                          >
                            <ArrowUUpLeftIcon />
                            Restore
                          </Button>
                        </div>

                        {diff.length === 0 ? (
                          <p className="text-[12px] text-muted-foreground">
                            Identical to what is open now.
                          </p>
                        ) : (
                          <>
                            <p className="mb-2 text-[11.5px] text-muted-foreground">
                              {pluralize(diff.length, "change")} since this
                              version.
                            </p>
                            <ul className="flex flex-col gap-1.5">
                              {diff.slice(0, 24).map((entry) => (
                                <li
                                  key={`${entry.id}-${entry.change}`}
                                  className="flex items-start gap-2 text-[11.5px] leading-[1.45]"
                                >
                                  <span
                                    className={cn(
                                      "mt-[5px] size-1.5 flex-none rounded-full",
                                      entry.change === "added" && "bg-success",
                                      entry.change === "removed" &&
                                        "bg-destructive",
                                      entry.change === "changed" &&
                                        "bg-primary",
                                      entry.change === "moved" && "bg-warning"
                                    )}
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="font-medium capitalize">
                                      {entry.change}
                                    </span>{" "}
                                    <span className="text-muted-foreground">
                                      {entry.label}
                                    </span>
                                    <ChangeDetail entry={entry} />
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      <LoadMore {...versions} />
    </div>
  )
}

/**
 * What the change actually was, under the line naming it.
 *
 * Dates are stored as `2024-03` and a version list is one of the few places a
 * reader sees a raw field value, so the ones that are dates are formatted the
 * way the document shows them.
 */
function ChangeDetail({ entry }: { entry: NodeDiff }) {
  if (entry.change === "moved") {
    const from = typeof entry.before === "number" ? entry.before + 1 : null
    const to = typeof entry.after === "number" ? entry.after + 1 : null
    if (from === null || to === null) return null
    return (
      <span className="mt-0.5 block text-muted-foreground">
        position {from} to {to}
      </span>
    )
  }

  if (entry.change === "added" || entry.change === "removed") {
    return (
      <span
        className={cn(
          "mt-0.5 block line-clamp-2",
          entry.change === "removed" &&
            "text-muted-foreground line-through decoration-border"
        )}
      >
        {nodeSummary(entry.change === "added" ? entry.after : entry.before)}
      </span>
    )
  }

  if (!entry.fields?.length) return null

  return (
    <span className="mt-1 flex flex-col gap-1.5">
      {entry.fields.map((field) => (
        <FieldChangeRow key={field.field} field={field} />
      ))}
    </span>
  )
}

/**
 * One changed field, drawn the way its length wants to be read.
 *
 * A sentence gets a word diff, so a one-word fix reads as a one-word fix
 * instead of two paragraphs to compare by eye. Anything shorter gets an arrow:
 * on a two-word value a struck-through fragment beside a highlighted one is
 * noisier than simply saying what it was and what it is.
 */
function FieldChangeRow({ field }: { field: FieldChange }) {
  if (PROSE_FIELDS.has(field.field)) {
    return (
      <span className="flex flex-col">
        <FieldName field={field.field} />
        <WordDiff
          before={field.before ?? ""}
          after={field.after ?? ""}
          className="text-[11.5px] leading-[1.5]"
        />
      </span>
    )
  }

  return (
    <span className="flex flex-col">
      <FieldName field={field.field} />
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="line-clamp-2 min-w-0 text-muted-foreground line-through decoration-border">
          {fieldValue(field.field, field.before)}
        </span>
        <span className="flex-none text-muted-foreground">{"\u2192"}</span>
        <span className="line-clamp-2 min-w-0 font-medium">
          {fieldValue(field.field, field.after)}
        </span>
      </span>
    </span>
  )
}

/**
 * A bullet holds nothing but its text, and the breadcrumb above already says
 * "bullet 2", so naming the field there is noise. Every other field is one
 * named part of a node that has several.
 */
function FieldName({ field }: { field: string }) {
  if (field === "text") return null
  return (
    <span className="text-[10.5px] text-muted-foreground lowercase">
      {field}
    </span>
  )
}

/** The fields the schema types as `Text` rather than `Short`. */
const PROSE_FIELDS = new Set(["text", "summary"])

const DATE_FIELDS = new Set(["start", "end"])

/** An unset side reads as "(none)" so the arrow always has both ends. */
function fieldValue(field: FieldChange["field"], value?: string): string {
  if (!value) return "(none)"
  if (!DATE_FIELDS.has(field)) return value
  return value === "present" ? "Present" : formatYearMonth(value)
}
