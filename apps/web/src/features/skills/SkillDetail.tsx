import { InfoIcon } from "@phosphor-icons/react"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "sonner"

import { type SkillRow, useSetSkillEnabled } from "@/lib/queries"

/**
 * A built-in skill, read only.
 *
 * Its playbook text is compiled into the server bundle and reaches the model
 * through `load_skill` alone, so there is nothing to read here and nothing to
 * edit: the one thing a user can do to a built-in is switch it off.
 */
export function SkillDetail({ row }: { row: SkillRow }) {
  const setEnabled = useSetSkillEnabled()

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-[720px] px-[26px] pt-[26px] pb-[110px]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-heading text-[19px] font-semibold tracking-[-0.015em]">
              {row.name}
            </h2>
            <p className="mt-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
              Built in · {row.category === "interview" ? "Interview" : "Editor"}
            </p>
          </div>
          <div className="flex flex-none items-center gap-2 pt-1">
            <span className="text-[11.5px] text-muted-foreground">
              {row.enabled ? "On" : "Off"}
            </span>
            <Switch
              checked={row.enabled}
              disabled={setEnabled.isPending}
              onCheckedChange={(enabled) =>
                setEnabled.mutate(
                  { skillId: row.id, disabled: !enabled },
                  { onError: (error) => toast.error(error.message) }
                )
              }
              aria-label={
                row.enabled ? `Disable ${row.name}` : `Enable ${row.name}`
              }
            />
          </div>
        </div>

        <Block label="When to use it">{row.whenToUse}</Block>
        {row.notFor ? <Block label="Not for">{row.notFor}</Block> : null}

        <div className="mt-7 flex items-start gap-2.5 rounded-[10px] border border-border bg-canvas p-3.5">
          <InfoIcon className="mt-px size-4 flex-none text-muted-foreground" />
          <p className="text-[12px] leading-[1.55] text-muted-foreground">
            Its playbook text stays on the server and is never sent to the
            browser, so it cannot be read or edited here. Switching it off stops
            the assistant being offered it, here and in the composer.
          </p>
        </div>
      </div>
    </div>
  )
}

function Block({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-7">
      <h3 className="text-[10.5px] font-bold tracking-[0.05em] text-muted-foreground uppercase">
        {label}
      </h3>
      <p className="mt-1.5 max-w-[62ch] text-[12.5px] leading-[1.55]">
        {children}
      </p>
    </section>
  )
}
