import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { useState } from "react"

import { DeleteSkillDialog } from "@/features/skills/DeleteSkillDialog"
import { ImportSkillDialog } from "@/features/skills/ImportSkillDialog"
import { SkillDetail } from "@/features/skills/SkillDetail"
import { BLANK_SKILL, SkillForm } from "@/features/skills/SkillForm"
import { NEW_SKILL_ID } from "@/features/skills/workspace"
import { useWorkspace } from "@/features/workspace/context"
import { ResourceFailure } from "@/features/workspace/ResourceFailure"
import { tabKey } from "@/features/workspace/targets"
import { useTabScroll } from "@/features/workspace/use-tab-scroll"

import { type SkillRow, skillsQuery, userSkillQuery } from "@/lib/queries"

/**
 * One skill, in its own tab.
 *
 * Three things can be behind an id, and they look nothing alike: a built-in
 * has no body in the browser, a custom skill is a form, and an id the library
 * no longer holds is a tab to close. Which one it is comes from the list the
 * strip already has, so the tab and the row that opened it agree.
 */
export const Route = createFileRoute("/_app/skills/$skillId")({
  component: SkillTab,
})

function SkillTab() {
  const { skillId } = Route.useParams()
  const { data, isPending, error, refetch } = useQuery(skillsQuery())
  const row = data?.find((entry) => entry.id === skillId)

  if (skillId === NEW_SKILL_ID) return <NewSkillTab key="new" />
  if (isPending) return <Waiting />
  if (error && !data)
    return (
      <ResourceFailure
        error={error}
        reset={() => {
          void refetch()
        }}
      />
    )
  if (!row || row.deleted) return <Gone name={row?.name} />
  if (row.source === "builtin") return <SkillDetail row={row} />
  return <CustomSkillTab key={row.id} row={row} />
}

function NewSkillTab() {
  const workspace = useWorkspace()
  const [importing, setImporting] = useState(false)
  const editor = workspace.ensureSkill(NEW_SKILL_ID)

  return (
    <Shell
      title="New skill"
      note="A skill is guidance the assistant reads before proposing changes. It
        cannot widen what a turn may do: every suggestion it shapes is still a
        card you accept or reject."
      action={
        <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
          <UploadSimpleIcon />
          Upload SKILL.md
        </Button>
      }
    >
      <SkillForm
        initial={BLANK_SKILL}
        editor={editor}
        saveEditor={() => workspace.saveSkill(editor)}
        onSaved={() => undefined}
        onCancel={() => {
          void workspace.requestCloseTabs([
            tabKey({ kind: "skill", skillId: NEW_SKILL_ID }),
          ])
        }}
      />
      <ImportSkillDialog
        open={importing}
        onOpenChange={setImporting}
        onImported={(input) => {
          editor.replace(input)
          setImporting(false)
        }}
      />
    </Shell>
  )
}

function CustomSkillTab({ row }: { row: SkillRow }) {
  const detail = useQuery(userSkillQuery(row.id))
  const workspace = useWorkspace()
  const [deleting, setDeleting] = useState(false)

  if (detail.isPending) return <Waiting />
  if (detail.error && !detail.data)
    return (
      <ResourceFailure
        error={detail.error}
        reset={() => {
          void detail.refetch()
        }}
      />
    )
  if (!detail.data) return <Gone name={row.name} />

  const skill = detail.data
  const editor = workspace.ensureSkill(skill.id, skill)
  return (
    <Shell
      meta={`Yours · ${row.category === "interview" ? "Interview" : "Editor"}`}
      action={
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setDeleting(true)}
        >
          <TrashIcon />
          Delete
        </Button>
      }
    >
      <SkillForm
        initial={skill}
        skillId={skill.id}
        editor={editor}
        saveEditor={() => workspace.saveSkill(editor)}
        onSaved={() => undefined}
        onCancel={() => {
          void workspace.requestCloseTabs([
            tabKey({ kind: "skill", skillId: skill.id }),
          ])
        }}
      />
      <DeleteSkillDialog
        target={deleting ? { id: skill.id, name: skill.name } : null}
        onClose={() => setDeleting(false)}
      />
    </Shell>
  )
}

/**
 * The id names nothing the library still holds: a skill deleted while its tab
 * was open, or a URL from a copy someone else made.
 */
function Gone({ name }: { name?: string }) {
  const workspace = useWorkspace()
  const { skillId } = Route.useParams()

  return (
    <Shell title={name ?? "This skill"}>
      <p className="text-[12.5px] text-muted-foreground">
        It is not in your library any more. Suggestions it shaped earlier still
        carry its name.
      </p>
      <div className="mt-4">
        <Button
          size="sm"
          onClick={() => {
            void workspace.requestCloseTabs([
              tabKey({ kind: "skill", skillId }),
            ])
          }}
        >
          Close this tab
        </Button>
      </div>
    </Shell>
  )
}

function Waiting() {
  return (
    <div className="flex min-h-0 flex-1 items-center gap-2 p-6 text-[12px] text-muted-foreground">
      <Spinner className="size-3.5" />
      Loading the skill
    </div>
  )
}

/** The tab's page: one column, scrolling, with the form or the prose inside. */
function Shell({
  title,
  meta,
  note,
  action,
  children,
}: {
  title?: string
  meta?: string
  note?: string
  /** The one thing this page can do to the skill it is showing. */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const { skillId } = Route.useParams()
  const scroll = useTabScroll(`skill:${skillId}`)
  return (
    <div ref={scroll} className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-[720px] px-[26px] pt-[26px] pb-[110px]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title ? (
              <h2 className="font-heading text-[19px] font-semibold tracking-[-0.015em]">
                {title}
              </h2>
            ) : null}
            {meta ? (
              <p className="mt-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
                {meta}
              </p>
            ) : null}
          </div>
          {action ? (
            <div className="flex flex-none items-center gap-2 pt-1">
              {action}
            </div>
          ) : null}
        </div>
        {note ? (
          <p className="mt-1.5 mb-5 max-w-[62ch] text-[12.5px] text-muted-foreground">
            {note}
          </p>
        ) : (
          <div className="mb-5" />
        )}
        {children}
      </div>
    </div>
  )
}
