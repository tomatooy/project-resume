import { FilePlusIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { templates } from "@workspace/resume-render"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { useState } from "react"

import { ImportDialog } from "@/features/import/ImportDialog"
import { ResumeThumb } from "@/features/resume/preview/TemplateThumb"
import { listResumes } from "@/lib/api"
import { SKELETON_KEYS, relativeTime } from "@/lib/format"
import { qk } from "@/lib/query-keys"

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
})

function Dashboard() {
  const { data, isPending } = useQuery({
    queryKey: qk.resumes(),
    queryFn: listResumes,
  })
  const [importing, setImporting] = useState(false)

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-[880px] px-[26px] pt-[26px] pb-[110px]">
        <h2 className="font-heading text-[19px] font-semibold tracking-[-0.015em]">
          My resumes
        </h2>
        <p className="mt-1.5 mb-5 text-[12.5px] text-muted-foreground">
          One document per role you are chasing. Duplicate a master copy, then
          tailor it against the posting.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {isPending
            ? SKELETON_KEYS.map((key) => (
                <Skeleton key={key} className="h-[104px] rounded-[10px]" />
              ))
            : data?.map((resume) => (
                <Link
                  key={resume.id}
                  to="/r/$resumeId/edit"
                  params={{ resumeId: resume.id }}
                  className="flex items-start gap-3.5 rounded-[10px] border border-border bg-paper p-4 transition-colors hover:border-primary/35"
                >
                  <ResumeThumb
                    accent={templates[resume.templateId]?.accent ?? "#0069a8"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-heading text-[13.5px] font-semibold tracking-[-0.01em]">
                      {resume.title}
                    </div>
                    <div className="mt-1 truncate text-[12px] text-muted-foreground">
                      {resume.subtitle}
                    </div>
                    <div className="mt-2.5 text-[11px] text-muted-foreground">
                      {templates[resume.templateId]?.name} · edited{" "}
                      {relativeTime(resume.updatedAt)}
                    </div>
                  </div>
                </Link>
              ))}

          <button
            type="button"
            onClick={() => setImporting(true)}
            className="flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-border text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-primary hover:bg-paper hover:text-primary disabled:opacity-60"
          >
            <FilePlusIcon className="size-5" />
            Create a new resume
          </button>
        </div>

        <div className="mt-8 rounded-[10px] border border-border bg-paper p-4">
          <div className="mb-2 text-[10.5px] font-bold tracking-[0.05em] text-muted-foreground uppercase">
            Getting started
          </div>
          <ol className="flex list-inside list-decimal flex-col gap-1.5 text-[12.5px] leading-[1.55] text-muted-foreground">
            <li>Open a resume and fill in Contact, then Experience.</li>
            <li>
              Watch the live preview on the right; switch templates from its
              header.
            </li>
            <li>
              Turn on the Assistant panel, pick a skill, and accept the changes
              you agree with.
            </li>
            <li>Export a PDF once Preflight is clean.</li>
          </ol>
          <Button
            className="mt-3.5"
            size="sm"
            onClick={() => setImporting(true)}
          >
            Start a resume
          </Button>
        </div>
      </div>

      <ImportDialog open={importing} onOpenChange={setImporting} />
    </div>
  )
}
