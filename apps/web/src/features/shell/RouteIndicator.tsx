import { Link, useRouterState } from "@tanstack/react-router"
import { useStore } from "@tanstack/react-store"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import { cn } from "@workspace/ui/lib/utils"

import { NEW_SKILL_ID } from "@/features/skills/workspace"
import { useWorkspace } from "@/features/workspace/context"
import type { SkillEditor } from "@/features/workspace/skill-editor"
import type { ResumeRuntime } from "@/features/workspace/store"
import {
  routeTarget,
  tabRoute,
  type TabTarget,
} from "@/features/workspace/targets"
import { useResumeSummaries, useSkillNames } from "@/lib/queries"
import { RESUME_TABS } from "./resume-tabs"

export function RouteIndicator() {
  const path = useRouterState({
    select: (s) => (s.resolvedLocation ?? s.location).pathname,
  })
  const target = routeTarget(path)

  return (
    <Breadcrumb aria-label="Current location" className="min-w-0 flex-1">
      <BreadcrumbList className="flex-nowrap gap-0 overflow-hidden py-0.5 text-[11px] whitespace-nowrap">
        <BreadcrumbItem className="shrink-0">
          <BreadcrumbLink
            render={<Link to="/dashboard" />}
            className="rounded-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            vs:resume
          </BreadcrumbLink>
        </BreadcrumbItem>
        {target?.kind === "resume" ? (
          <ResumePath target={target} />
        ) : target?.kind === "skill" ? (
          <SkillPath skillId={target.skillId} />
        ) : (
          <PathSegment
            label={
              target?.kind === "skills"
                ? "skills"
                : target?.kind === "autofill"
                  ? "autofill"
                  : "myresumes"
            }
          />
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function ResumePath({
  target,
}: {
  target: Extract<TabTarget, { kind: "resume" }>
}) {
  const workspace = useWorkspace()
  const runtime = useStore(workspace.store, () =>
    workspace.resumes.get(target.resumeId)
  )
  const [summary] = useResumeSummaries([target.resumeId])
  const view = RESUME_TABS.find((tab) => tab.id === target.view)

  return (
    <>
      <PathSegment label="myresumes" target={null} className="shrink-0" />
      <PathSegment
        label={summary?.data?.title ?? "Resume"}
        target={{ ...target, view: "editor" }}
        className="max-w-64"
      />
      {target.view === "editor" && runtime ? (
        <ResumeSection runtime={runtime} />
      ) : (
        <PathSegment label={view?.label ?? "Editor"} />
      )}
    </>
  )
}

function ResumeSection({ runtime }: { runtime: ResumeRuntime }) {
  const pane = useStore(runtime.ui, (s) => s.pane)
  const sectionTitle = useStore(
    runtime.session.store,
    (s) => s.doc.sections.find((section) => section.id === pane)?.title
  )
  const label =
    pane === "summary"
      ? "Summary"
      : sectionTitle === undefined
        ? "Contact"
        : sectionTitle.trim() || "Untitled section"

  return <PathSegment label={label} />
}

function SkillPath({ skillId }: { skillId: string }) {
  const workspace = useWorkspace()
  const editor = useStore(workspace.store, () => workspace.skills.get(skillId))
  const names = useSkillNames()
  const name =
    skillId === NEW_SKILL_ID ? "New skill" : (names[skillId] ?? "Skill")

  return (
    <>
      <PathSegment
        label="skills"
        target={{ kind: "skills" }}
        className="shrink-0"
      />
      {editor ? (
        <SkillName editor={editor} fallback={name} />
      ) : (
        <PathSegment label={name} />
      )}
    </>
  )
}

function SkillName({
  editor,
  fallback,
}: {
  editor: SkillEditor
  fallback: string
}) {
  const name = useStore(editor.store, (s) => s.fields.name)
  return <PathSegment label={name.trim() || fallback} />
}

function PathSegment({
  label,
  target,
  className,
}: {
  label: string
  target?: TabTarget | null
  className?: string
}) {
  return (
    <>
      <BreadcrumbSeparator className="shrink-0 text-muted-foreground">
        /
      </BreadcrumbSeparator>
      <BreadcrumbItem className={cn("min-w-0", className)}>
        {target === undefined ? (
          <BreadcrumbPage
            title={label}
            className="truncate text-muted-foreground"
          >
            {label}
          </BreadcrumbPage>
        ) : (
          <BreadcrumbLink
            render={<Link {...tabRoute(target)} />}
            title={label}
            className="truncate rounded-sm text-muted-foreground outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {label}
          </BreadcrumbLink>
        )}
      </BreadcrumbItem>
    </>
  )
}
