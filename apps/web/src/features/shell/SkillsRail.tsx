import { PencilSimpleIcon, PlusIcon, SparkleIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { Switch } from "@workspace/ui/components/switch"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { toast } from "sonner"

import { NEW_SKILL_ID } from "@/features/skills/workspace"
import { type SkillRow, skillsQuery, useSetSkillEnabled } from "@/lib/queries"
import { IconButton } from "./IconButton"
import { RailSkeleton } from "./RailSkeleton"

/**
 * The playbook library in the rail, in the same shape as the resume list.
 *
 * Grouped the way a skill is filed rather than the way it is stored: what the
 * assistant may draw on while editing, and what it may draw on in an
 * interview. Editing is where most of the library lives, so it is the one
 * group that splits further, into the playbooks shipped with the app and the
 * ones the user wrote.
 *
 * A row opens the skill in a tab, which is where the detail or the form is;
 * the switch beside it is the same switch as in the library list.
 */
export function SkillsRail() {
  const { data, isPending } = useQuery(skillsQuery())
  const setEnabled = useSetSkillEnabled()
  const params = useParams({ strict: false })
  const activeId = "skillId" in params ? params.skillId : undefined

  const rows = (data ?? []).filter((row) => !row.deleted)
  const editor = rows.filter((row) => row.category === "editor")
  const interview = rows.filter((row) => row.category === "interview")

  function toggle(row: SkillRow, enabled: boolean) {
    setEnabled.mutate(
      { skillId: row.id, disabled: !enabled },
      { onError: (error) => toast.error(error.message) }
    )
  }

  const item = (row: SkillRow) => (
    <SkillRowLink
      key={row.id}
      row={row}
      selected={row.id === activeId}
      busy={setEnabled.isPending}
      onToggle={(enabled) => toggle(row, enabled)}
    />
  )

  return (
    <>
      <div className="flex h-[42px] flex-none items-center gap-1.5 px-2.5">
        <span className="text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
          Skills
        </span>
        {isPending ? (
          <Skeleton className="h-4 w-5 bg-foreground/10 motion-reduce:animate-none" />
        ) : (
          <span className="rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {rows.length}
          </span>
        )}
        <div className="flex-1" />
        <IconButton
          label="Write a new skill"
          // A link, not a button: it opens a tab, so it keeps link semantics.
          nativeButton={false}
          render={
            <Link to="/skills/$skillId" params={{ skillId: NEW_SKILL_ID }} />
          }
        >
          <PlusIcon weight="bold" />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1.5 pb-3">
        {isPending ? (
          <RailSkeleton />
        ) : (
          <>
            <Group label="Editor">
              <SubLabel>Default</SubLabel>
              {editor
                .filter((row) => row.source === "builtin")
                .map((row) => item(row))}
              <SubLabel>Custom</SubLabel>
              {editor.some((row) => row.source === "custom") ? (
                editor
                  .filter((row) => row.source === "custom")
                  .map((row) => item(row))
              ) : (
                <Note>Nothing of your own yet.</Note>
              )}
            </Group>

            <Group label="Interview">
              {interview.length > 0 ? (
                interview.map((row) => item(row))
              ) : (
                <Note>No interview skills yet.</Note>
              )}
            </Group>
          </>
        )}
      </div>
    </>
  )
}

/** One skill: the row opens its tab, the switch turns it off in place. */
function SkillRowLink({
  row,
  selected,
  busy,
  onToggle,
}: {
  row: SkillRow
  selected: boolean
  busy: boolean
  onToggle: (enabled: boolean) => void
}) {
  return (
    <div className="group/row relative">
      <Link
        to="/skills/$skillId"
        params={{ skillId: row.id }}
        title={row.name}
        className={cn(
          "flex h-[26px] w-full items-center gap-1.5 rounded-[6px] pr-8 pl-2 transition-colors",
          selected ? "text-primary-text" : "hover:bg-muted",
          // A switched-off skill stays readable but stops looking live, which
          // is the one thing the rail has to show about it.
          !selected &&
            (row.enabled ? "text-foreground/60" : "text-foreground/35")
        )}
      >
        {row.source === "builtin" ? (
          <SparkleIcon className="size-3.5 flex-none opacity-70" />
        ) : (
          <PencilSimpleIcon className="size-3.5 flex-none opacity-70" />
        )}
        <span className="min-w-0 flex-1 truncate text-[12.5px]">
          {row.name}
        </span>
      </Link>
      {/* Outside the link on purpose: a nested control would be one target
          with two jobs. */}
      <Switch
        size="sm"
        className="absolute top-1/2 right-1.5 -translate-y-1/2"
        checked={row.enabled}
        disabled={busy}
        onCheckedChange={onToggle}
        aria-label={row.enabled ? `Disable ${row.name}` : `Enable ${row.name}`}
      />
    </div>
  )
}

function Group({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-px py-1.5">
      <h2 className="px-2 pb-0.5 text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        {label}
      </h2>
      {children}
    </section>
  )
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium tracking-[0.06em] text-muted-foreground/70 uppercase">
      {children}
    </h3>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pb-1 text-[11px] text-muted-foreground/80">{children}</p>
  )
}
