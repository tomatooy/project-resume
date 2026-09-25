import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers"
import { CSS } from "@dnd-kit/utilities"
import {
  BooksIcon,
  DotsThreeIcon,
  FileTextIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useRouterState } from "@tanstack/react-router"
import { useStore } from "@tanstack/react-store"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"

import { RESUME_TABS } from "@/features/shell/resume-tabs"
import { LoadMore } from "@/features/shell/LoadMore"
import { useResumes, useResumeSummaries, useSkillNames } from "@/lib/queries"
import { useWorkspace } from "./context"
import { routeTarget, tabKey, type TabTarget } from "./targets"
import type { ResumeRuntime } from "./store"
import type { SkillEditor } from "./skill-editor"

export function WorkspaceTabs({ children }: { children: ReactNode }) {
  const workspace = useWorkspace()
  const { tabs, closing } = useStore(workspace.store)
  const path = useRouterState({
    select: (s) => (s.resolvedLocation ?? s.location).pathname,
  })
  const active = routeTarget(path)
  const activeKey = active ? tabKey(active) : "dashboard"
  const resumes = useResumes()
  const summaries = useResumeSummaries(
    tabs.flatMap((tab) => (tab.kind === "resume" ? [tab.resumeId] : []))
  )
  const names = useSkillNames()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )
  const strip = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!tabs.some((tab) => tabKey(tab) === activeKey)) return
    strip.current
      ?.querySelector<HTMLElement>("[data-active]")
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }, [activeKey, tabs])

  function label(target: TabTarget): string {
    if (target.kind === "skills") return "All skills"
    if (target.kind === "skill")
      return target.skillId === "new"
        ? "New skill"
        : (names[target.skillId] ?? "Skill")
    const name =
      summaries.find((q) => q.data?.id === target.resumeId)?.data?.title ??
      "Resume"
    return `${RESUME_TABS.find((t) => t.id === target.view)?.label ?? "Editor"} · ${name}`
  }

  const open = (target: TabTarget) => {
    void workspace
      .openTab(target)
      .catch((error: Error) => toast.error(error.message))
  }
  return (
    <Tabs
      value={activeKey}
      onValueChange={(value, details) => {
        if (details.reason === "none" && typeof value === "string")
          void workspace
            .activateTab(value)
            .catch((error: Error) => toast.error(error.message))
      }}
      className="h-full min-h-0 gap-0"
    >
      <div
        className="flex h-fit flex-none items-stretch bg-background shadow-[inset_0_-1px_0_var(--border)]"
        inert={closing}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragEnd={({ active: dragged, over }) => {
            if (over && dragged.id !== over.id)
              workspace.moveTab(
                String(dragged.id),
                tabs.findIndex((t) => tabKey(t) === over.id)
              )
          }}
        >
          <div
            ref={strip}
            className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <SortableContext
              items={tabs.map(tabKey)}
              strategy={horizontalListSortingStrategy}
            >
              <TabsList
                aria-label="Workspace pages"
                className="h-full min-w-full justify-start rounded-none bg-transparent p-0"
              >
                {tabs.map((target, index) => (
                  <WorkspaceTab
                    key={tabKey(target)}
                    target={target}
                    label={label(target)}
                    current={activeKey === tabKey(target)}
                    index={index}
                  />
                ))}
              </TabsList>
            </SortableContext>
          </div>
        </DndContext>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open a tab"
                className="mx-1 self-center"
              />
            }
          >
            <PlusIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Open resume</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 w-64 overflow-auto">
                {resumes.data?.map((resume) => (
                  <DropdownMenuItem
                    key={resume.id}
                    onClick={() =>
                      open({
                        kind: "resume",
                        resumeId: resume.id,
                        view: "editor",
                      })
                    }
                  >
                    {resume.title}
                  </DropdownMenuItem>
                ))}
                <LoadMore {...resumes} />
                {!resumes.data?.length ? (
                  <DropdownMenuItem disabled>No resumes yet</DropdownMenuItem>
                ) : null}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {active?.kind === "resume"
              ? RESUME_TABS.map((view) => (
                  <DropdownMenuItem
                    key={view.id}
                    onClick={() => open({ ...active, view: view.id })}
                  >
                    {view.label}
                  </DropdownMenuItem>
                ))
              : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => open({ kind: "skills" })}>
              All skills
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => open({ kind: "skill", skillId: "new" })}
            >
              New skill
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Tab actions"
                className="self-center"
              />
            }
          >
            <DotsThreeIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              disabled={!active}
              onClick={() => {
                void workspace.requestCloseTabs(
                  tabs.filter((t) => tabKey(t) !== activeKey).map(tabKey)
                )
              }}
            >
              Close other tabs
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!tabs.length}
              onClick={() => {
                void workspace.requestCloseTabs(tabs.map(tabKey))
              }}
            >
              Close all tabs
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div id="workspace-tab-actions" className="flex items-center px-1" />
      </div>
      <TabsContent
        value={activeKey}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {children}
      </TabsContent>
    </Tabs>
  )
}

function WorkspaceTab({
  target,
  label,
  current,
  index,
}: {
  target: TabTarget
  label: string
  current: boolean
  index: number
}) {
  const workspace = useWorkspace()
  const key = tabKey(target)
  const { setNodeRef, transform, transition, listeners, isDragging } =
    useSortable({ id: key })
  const runtime =
    target.kind === "resume" ? workspace.resumes.get(target.resumeId) : null
  const editor =
    target.kind === "skill" ? workspace.skills.get(target.skillId) : null
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onPointerDown={(event) => listeners?.onPointerDown?.(event)}
      className={cn(
        "group/tab flex h-full flex-none items-center",
        current ? "bg-card text-foreground" : "text-muted-foreground",
        isDragging && "z-10 opacity-60"
      )}
    >
      <TabsTrigger
        value={key}
        title={`${label}. Double-click to move it to the front. Alt+Shift+Arrow to reorder.`}
        className="h-full max-w-64 flex-none rounded-none border-0 pr-1 pl-3 font-heading text-xs data-active:bg-card group-data-[variant=default]/tabs-list:data-active:shadow-none"
        onDoubleClick={() => {
          if (index > 0) workspace.moveTab(key, 0)
        }}
        onKeyDown={(event) => {
          if (
            event.altKey &&
            event.shiftKey &&
            (event.key === "ArrowLeft" || event.key === "ArrowRight")
          ) {
            event.preventDefault()
            event.stopPropagation()
            workspace.moveTab(key, index + (event.key === "ArrowLeft" ? -1 : 1))
          }
        }}
      >
        {target.kind === "resume" ? <FileTextIcon /> : <BooksIcon />}
        <span className="truncate">{label}</span>
        {runtime ? <ResumeBadge runtime={runtime} /> : null}
        {editor ? <SkillBadge editor={editor} /> : null}
      </TabsTrigger>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Close ${label}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          void workspace.requestCloseTabs([key])
        }}
        className={cn(
          "size-5 flex-none hover:bg-muted",
          !current &&
            "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100"
        )}
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  )
}

function ResumeBadge({ runtime }: { runtime: ResumeRuntime }) {
  const status = useStore(runtime.session.store, (s) => s.saveStatus)
  return (
    <>
      {status !== "saved" ? (
        <span
          role="img"
          title={status}
          aria-label={status}
          className={cn(
            "size-1.5 rounded-full bg-warning",
            (status === "conflict" || status === "error") && "bg-destructive"
          )}
        />
      ) : null}
      {runtime.assistant ? (
        <AssistantBadge runtime={runtime.assistant} />
      ) : null}
    </>
  )
}
function AssistantBadge({
  runtime,
}: {
  runtime: NonNullable<ResumeRuntime["assistant"]>
}) {
  const state = useStore(runtime.store)
  return state.running ? (
    <span
      role="img"
      aria-label="Assistant working"
      className="size-1.5 animate-pulse rounded-full bg-primary"
    />
  ) : state.unread ? (
    <span
      role="img"
      aria-label="Assistant finished"
      className="size-1.5 rounded-full bg-success"
    />
  ) : null
}
function SkillBadge({ editor }: { editor: SkillEditor }) {
  const dirty = useStore(editor.store, (s) => s.dirty)
  return dirty ? (
    <span
      role="img"
      aria-label="Unsaved changes"
      className="size-1.5 rounded-full bg-warning"
    />
  ) : null
}

export function WorkspaceTabActions({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setHost(document.getElementById("workspace-tab-actions"))
  }, [])
  return host ? createPortal(children, host) : null
}
