import { useTabScroll } from "@/features/workspace/use-tab-scroll"
import { ResourceFailure } from "@/features/workspace/ResourceFailure"
import { PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Switch } from "@workspace/ui/components/switch"
import { useState } from "react"
import { toast } from "sonner"

import { DeleteSkillDialog } from "@/features/skills/DeleteSkillDialog"
import { NEW_SKILL_ID } from "@/features/skills/workspace"
import { IconButton } from "@/features/shell/IconButton"
import { type SkillRow, skillsQuery, useSetSkillEnabled } from "@/lib/queries"
import { useNavigate, createFileRoute } from "@tanstack/react-router"

/**
 * The library itself: every skill the assistant may draw on, built in and
 * written by the user, each with the switch that turns it off.
 *
 * The rail lists the same rows in a smaller shape; this is where a skill's
 * line about when it applies is readable in full, and where writing starts.
 * Opening one is a tab, so the list stays where it is.
 */
export const Route = createFileRoute("/_app/skills/")({
  component: SkillsLibrary,
})

function SkillsLibrary() {
  const scroll = useTabScroll("skills")
  const { data, isPending, error, refetch } = useQuery(skillsQuery())
  const setEnabled = useSetSkillEnabled()
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState<SkillRow | null>(null)

  const rows = data ?? []
  const builtins = rows.filter((row) => row.source === "builtin")
  const custom = rows.filter((row) => row.source === "custom" && !row.deleted)

  const open = (id: string) =>
    void navigate({ to: "/skills/$skillId", params: { skillId: id } })

  function toggle(row: SkillRow, enabled: boolean) {
    setEnabled.mutate(
      { skillId: row.id, disabled: !enabled },
      { onError: (error) => toast.error(error.message) }
    )
  }

  if (error && !data)
    return (
      <ResourceFailure
        error={error}
        reset={() => {
          void refetch()
        }}
      />
    )

  return (
    <div ref={scroll} className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-[880px] px-[26px] pt-[26px] pb-[110px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-[19px] font-semibold tracking-[-0.015em]">
              Skills
            </h2>
            <p className="mt-1.5 max-w-[62ch] text-[12.5px] text-muted-foreground">
              Playbooks the assistant draws on when it proposes changes. Turn
              off the ones you do not want, or write your own.
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <Button size="sm" onClick={() => open(NEW_SKILL_ID)}>
              <PlusIcon />
              New skill
            </Button>
          </div>
        </div>

        <Section
          title="Built in"
          note="Written by us and kept on the server. Turn one off and it stops
            being offered to the assistant, here and in the composer."
        >
          {isPending ? (
            <SkeletonRows />
          ) : (
            builtins.map((row) => (
              <SkillCard
                key={row.id}
                row={row}
                busy={setEnabled.isPending}
                onToggle={(enabled) => toggle(row, enabled)}
                onOpen={() => open(row.id)}
              />
            ))
          )}
        </Section>

        <Section
          title="Yours"
          note="Your own playbooks. They are guidance the model reads, not code:
            nothing you write here can change what a turn is allowed to do."
        >
          {isPending ? (
            <SkeletonRows />
          ) : custom.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-border p-4 text-[12px] text-muted-foreground">
              You have not written a skill yet. Write one, or start from a
              SKILL.md someone shared.
            </p>
          ) : (
            custom.map((row) => (
              <SkillCard
                key={row.id}
                row={row}
                busy={setEnabled.isPending}
                onToggle={(enabled) => toggle(row, enabled)}
                onOpen={() => open(row.id)}
                onDelete={() => setDeleting(row)}
              />
            ))
          )}
        </Section>
      </div>

      <DeleteSkillDialog target={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}

function Section({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-7">
      <h3 className="text-[10.5px] font-bold tracking-[0.05em] text-muted-foreground uppercase">
        {title}
      </h3>
      <p className="mt-1 mb-2.5 max-w-[62ch] text-[12px] text-muted-foreground">
        {note}
      </p>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

function SkillCard({
  row,
  busy,
  onToggle,
  onOpen,
  onDelete,
}: {
  row: SkillRow
  busy: boolean
  onToggle: (enabled: boolean) => void
  onOpen: () => void
  onDelete?: () => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-border bg-card p-3.5">
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">{row.name}</span>
          <span className="flex-none rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {row.source === "custom" ? "Yours" : "Built in"}
          </span>
          {row.category === "interview" ? (
            <span className="flex-none rounded-[5px] bg-primary/9 px-1.5 py-0.5 text-[10px] font-semibold text-primary-text">
              Interview
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-[12px] leading-[1.5] text-muted-foreground">
          {row.description}
        </span>
        {row.notFor ? (
          <span className="mt-0.5 block text-[11.5px] text-muted-foreground/80">
            Not for: {row.notFor}
          </span>
        ) : null}
      </button>
      <div className="flex flex-none items-center gap-1">
        <IconButton label={`Open ${row.name}`} onClick={onOpen}>
          <PencilSimpleIcon />
        </IconButton>
        {onDelete ? (
          <IconButton label={`Delete ${row.name}`} onClick={onDelete}>
            <TrashIcon />
          </IconButton>
        ) : null}
        <Switch
          className="ml-1"
          checked={row.enabled}
          disabled={busy}
          onCheckedChange={onToggle}
          aria-label={
            row.enabled ? `Disable ${row.name}` : `Enable ${row.name}`
          }
        />
      </div>
    </div>
  )
}

function SkeletonRows() {
  return (
    <>
      <Skeleton className="h-[76px] rounded-[10px]" />
      <Skeleton className="h-[76px] rounded-[10px]" />
    </>
  )
}
