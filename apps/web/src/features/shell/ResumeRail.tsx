import { DotsThreeIcon, PlusIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { templates } from "@workspace/resume-render"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"
import { toast } from "sonner"

import { ImportDialog } from "@/features/import/ImportDialog"
import { SKELETON_KEYS, relativeTime } from "@/lib/format"
import {
  resumesQuery,
  useDeleteResume,
  useDuplicateResume,
} from "@/lib/queries"
import { ResumeThumb } from "../resume/preview/TemplateThumb"
import { RenameDialog } from "./RenameDialog"
import { DeleteResumeDialog } from "./DeleteResumeDialog"

/** The persistent 252px list of the user's resumes. */
export function ResumeRail() {
  const { data, isPending } = useQuery(resumesQuery())
  const params = useParams({ strict: false })
  const activeId = "resumeId" in params ? params.resumeId : undefined

  const navigate = useNavigate()
  const [renaming, setRenaming] = useState<{
    id: string
    title: string
  } | null>(null)
  const [deleting, setDeleting] = useState<{
    id: string
    title: string
  } | null>(null)
  const [importing, setImporting] = useState(false)

  const duplicate = useDuplicateResume()
  const remove = useDeleteResume()

  return (
    <nav className="flex w-[252px] flex-none flex-col overflow-hidden border-r border-border bg-canvas">
      <div className="flex flex-none items-center gap-2 px-3.5 pt-3.5 pb-2.5">
        <span className="text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
          My resumes
        </span>
        <span className="rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {data?.length ?? 0}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2.5 pb-3.5">
        {isPending
          ? SKELETON_KEYS.map((key) => (
              <Skeleton key={key} className="h-[76px] w-full rounded-[9px]" />
            ))
          : data?.map((resume) => {
              const selected = resume.id === activeId
              const accent = templates[resume.templateId]?.accent ?? "#0069a8"
              return (
                <div key={resume.id} className="group/card relative">
                  <Link
                    to="/r/$resumeId/edit"
                    params={{ resumeId: resume.id }}
                    className={cn(
                      "block w-full rounded-[9px] border p-[11px] text-left transition-colors",
                      selected
                        ? "border-primary/40 bg-primary/6 shadow-[0_0_0_3px_oklch(0.5_0.134_242.749/10%)]"
                        : "border-border bg-paper shadow-[0_1px_2px_oklch(0.145_0_0/4%)] hover:border-primary/25"
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <ResumeThumb accent={accent} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate pr-5 font-heading text-[12.5px] font-semibold tracking-[-0.01em]">
                          {resume.title}
                        </div>
                        <div className="mt-[3px] truncate text-[11px] text-muted-foreground">
                          {resume.subtitle}
                        </div>
                        <div className="mt-2 truncate text-[10.5px] text-muted-foreground">
                          Edited {relativeTime(resume.updatedAt)}
                        </div>
                      </div>
                    </div>
                  </Link>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          aria-label={`Actions for ${resume.title}`}
                          className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/card:opacity-100 hover:bg-muted focus-visible:opacity-100"
                        >
                          <DotsThreeIcon weight="bold" />
                        </button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem
                        onClick={() =>
                          setRenaming({ id: resume.id, title: resume.title })
                        }
                      >
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          duplicate.mutate(resume.id, {
                            onSuccess: (copy) =>
                              toast.success(`Duplicated as "${copy.title}"`),
                          })
                        }
                      >
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() =>
                          setDeleting({ id: resume.id, title: resume.title })
                        }
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            })}

        <button
          type="button"
          onClick={() => setImporting(true)}
          className="flex items-center gap-[9px] rounded-[9px] border border-dashed border-border p-3 text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:bg-paper hover:text-primary disabled:opacity-60"
        >
          <span className="flex size-[22px] flex-none items-center justify-center rounded-full border border-current">
            <PlusIcon className="size-3" weight="bold" />
          </span>
          Create new
        </button>
      </div>

      <ImportDialog open={importing} onOpenChange={setImporting} />
      <RenameDialog target={renaming} onClose={() => setRenaming(null)} />
      <DeleteResumeDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={(id) => {
          remove.mutate(id, {
            onSuccess: () => {
              if (id === activeId) void navigate({ to: "/dashboard" })
            },
          })
          setDeleting(null)
        }}
      />
    </nav>
  )
}
