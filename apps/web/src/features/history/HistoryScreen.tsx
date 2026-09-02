import { ArrowUUpLeftIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { diffDocuments, type NodeDiff } from "@workspace/resume-schema"
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
import { toast } from "sonner"

import { getVersion, listVersions, restoreVersion } from "@/lib/api"
import { SKELETON_KEYS, pluralize, relativeTime } from "@/lib/format"
import { qk } from "@/lib/query-keys"
import type { VersionSummary } from "@/lib/types"
import { useResumeState, useSession } from "../resume/session-context"

const AUTHOR: Record<VersionSummary["createdBy"], string> = {
  user: "You",
  agent: "Assistant",
  system: "Automatic",
}

export function HistoryScreen() {
  const session = useSession()
  const resumeId = useResumeState((s) => s.resumeId)
  const head = useResumeState((s) => s.doc)
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const versions = useQuery({
    queryKey: qk.versions(resumeId),
    queryFn: () => listVersions({ resumeId }),
  })

  const selected = useQuery({
    queryKey: qk.version(selectedId ?? ""),
    queryFn: () => getVersion({ id: selectedId ?? "" }),
    enabled: Boolean(selectedId),
  })

  const restore = useMutation({
    mutationFn: (versionId: string) => restoreVersion({ resumeId, versionId }),
    onSuccess: async (result) => {
      session.replaceHead(result.head, result.revision, result.updatedAt)
      await queryClient.invalidateQueries({ queryKey: qk.versions(resumeId) })
      setSelectedId(null)
      toast.success(result.version.label)
    },
  })

  const diff: NodeDiff[] = selected.data
    ? diffDocuments(selected.data.content, head)
    : []

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-[880px] px-[26px] pt-[26px] pb-[110px]">
        <h2 className="font-heading text-[19px] font-semibold tracking-[-0.015em]">
          History
        </h2>
        <p className="mt-1.5 mb-5 text-[12.5px] text-muted-foreground">
          A version is written when you accept a suggestion, save one by hand,
          or restore an older one. Typing alone never creates a version.
        </p>

        {versions.isPending ? (
          <div className="flex flex-col gap-2">
            {SKELETON_KEYS.slice(0, 3).map((key) => (
              <Skeleton key={key} className="h-[58px] rounded-[10px]" />
            ))}
          </div>
        ) : versions.data?.length === 0 ? (
          <Empty className="rounded-[10px] border border-dashed border-border py-12">
            <EmptyHeader>
              <EmptyTitle className="text-[13.5px]">No versions yet</EmptyTitle>
              <EmptyDescription className="text-[12px]">
                Use “Save version” in the editor to mark a point you can come
                back to.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="flex flex-col gap-2">
              {versions.data?.map((version) => {
                const active = version.id === selectedId
                return (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => setSelectedId(active ? null : version.id)}
                    className={cn(
                      "rounded-[10px] border bg-paper p-3.5 text-left transition-colors",
                      active
                        ? "border-primary/40 bg-primary/6"
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
                )
              })}
            </div>

            <div className="rounded-[10px] border border-border bg-paper p-4">
              {!selectedId ? (
                <p className="text-[12px] text-muted-foreground">
                  Select a version to see what changed since, and to restore it.
                </p>
              ) : selected.isPending ? (
                <Skeleton className="h-24" />
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
                      onClick={() => restore.mutate(selectedId)}
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
                        {pluralize(diff.length, "change")} since this version.
                      </p>
                      <ul className="flex flex-col gap-1.5">
                        {diff.slice(0, 24).map((entry) => (
                          <li
                            key={`${entry.id}-${entry.change}`}
                            className="flex items-start gap-2 text-[11.5px]"
                          >
                            <span
                              className={cn(
                                "mt-[5px] size-1.5 flex-none rounded-full",
                                entry.change === "added" && "bg-ok",
                                entry.change === "removed" && "bg-destructive",
                                entry.change === "changed" && "bg-primary",
                                entry.change === "moved" && "bg-flag"
                              )}
                            />
                            <span className="min-w-0">
                              <span className="font-medium capitalize">
                                {entry.change}
                              </span>{" "}
                              <span className="text-muted-foreground">
                                {entry.label}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
