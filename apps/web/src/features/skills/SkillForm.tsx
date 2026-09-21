import { useId, useState } from "react"
import { toast } from "sonner"
import {
  MAX_SKILL_BODY_CHARS,
  MAX_SKILL_NAME_CHARS,
  MAX_SKILL_NOT_FOR_CHARS,
  MAX_SKILL_STARTER_CHARS,
  MAX_SKILL_WHEN_TO_USE_CHARS,
  SkillCategorySchema,
  type UserSkillInput,
} from "@workspace/resume-core"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

import { useCreateUserSkill, useUpdateUserSkill } from "@/lib/queries"

/** A new skill starts empty, in the group the rail opens on. */
export const BLANK_SKILL: UserSkillInput = {
  category: "editor",
  name: "",
  whenToUse: "",
  body: "",
}

const CATEGORY_LABELS: Record<UserSkillInput["category"], string> = {
  editor: "Editor",
  interview: "Interview",
}

/**
 * Writing or editing one skill, in the tab that opened it.
 *
 * The form is the whole record: a name, the group it is filed under, when it
 * applies, optionally when it does not and what tapping its chip should write,
 * and the playbook text. Nothing here can give a skill authority; this is
 * prose the model reads, and the patch contract stays the gate.
 *
 * A built-in never reaches this form: its body stays on the server, which is
 * what the detail tab says instead.
 */
export function SkillForm({
  skillId,
  initial,
  onSaved,
  onCancel,
}: {
  /** Absent while the skill is still being written. */
  skillId?: string
  initial: UserSkillInput
  /** The saved id, which for a new skill is the tab's new address. */
  onSaved: (id: string) => void
  onCancel: () => void
}) {
  const [fields, setFields] = useState<UserSkillInput>(initial)
  const ids = useId()
  const create = useCreateUserSkill()
  const update = useUpdateUserSkill()
  const busy = create.isPending || update.isPending

  const bodyOver = fields.body.length > MAX_SKILL_BODY_CHARS
  const ready =
    fields.name.trim().length > 0 &&
    fields.whenToUse.trim().length > 0 &&
    fields.body.trim().length > 0 &&
    !bodyOver

  function set<K extends keyof UserSkillInput>(
    key: K,
    value: UserSkillInput[K]
  ) {
    setFields((current) => ({ ...current, [key]: value }))
  }

  function save() {
    const input = normalise(fields)
    if (skillId) {
      update.mutate(
        { ...input, id: skillId },
        {
          onSuccess: () => {
            toast.success("Skill saved")
            onSaved(skillId)
          },
          onError: (error) => toast.error(error.message),
        }
      )
      return
    }
    create.mutate(input, {
      onSuccess: (created) => {
        toast.success("Skill added")
        onSaved(created.id)
      },
      onError: (error) => toast.error(error.message),
    })
  }

  return (
    <div className="flex flex-col gap-3.5">
      <Field
        id={`${ids}-name`}
        label="Name"
        hint={`${fields.name.length} / ${MAX_SKILL_NAME_CHARS}`}
      >
        <Input
          id={`${ids}-name`}
          value={fields.name}
          maxLength={MAX_SKILL_NAME_CHARS}
          onChange={(event) => set("name", event.target.value)}
          placeholder="Tighten the summary"
        />
      </Field>

      <Field id={`${ids}-category`} label="Group">
        <Select
          items={SkillCategorySchema.options.map((value) => ({
            value,
            label: CATEGORY_LABELS[value],
          }))}
          value={fields.category}
          onValueChange={(value) =>
            set("category", SkillCategorySchema.parse(value))
          }
        >
          <SelectTrigger
            id={`${ids}-category`}
            className="w-full text-[12.5px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SkillCategorySchema.options.map((value) => (
              <SelectItem key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        id={`${ids}-when`}
        label="When to use it"
        hint={`${fields.whenToUse.length} / ${MAX_SKILL_WHEN_TO_USE_CHARS}`}
      >
        <Input
          id={`${ids}-when`}
          value={fields.whenToUse}
          maxLength={MAX_SKILL_WHEN_TO_USE_CHARS}
          onChange={(event) => set("whenToUse", event.target.value)}
          placeholder="The summary runs long and the user asks for a sharper opening."
        />
      </Field>

      <Field
        id={`${ids}-not-for`}
        label="Not for"
        optional
        hint={`${fields.notFor?.length ?? 0} / ${MAX_SKILL_NOT_FOR_CHARS}`}
      >
        <Input
          id={`${ids}-not-for`}
          value={fields.notFor ?? ""}
          maxLength={MAX_SKILL_NOT_FOR_CHARS}
          onChange={(event) => set("notFor", event.target.value)}
          placeholder="Cutting length, or adding content."
        />
      </Field>

      <Field
        id={`${ids}-starter`}
        label="Starter"
        optional
        hint={`${fields.starter?.length ?? 0} / ${MAX_SKILL_STARTER_CHARS}`}
      >
        <Input
          id={`${ids}-starter`}
          value={fields.starter ?? ""}
          maxLength={MAX_SKILL_STARTER_CHARS}
          onChange={(event) => set("starter", event.target.value)}
          placeholder="Sharpen my summary."
        />
      </Field>

      <Field
        id={`${ids}-body`}
        label="Playbook"
        hint={
          <span className={cn(bodyOver && "text-destructive")}>
            {fields.body.length} / {MAX_SKILL_BODY_CHARS}
          </span>
        }
      >
        <Textarea
          id={`${ids}-body`}
          value={fields.body}
          rows={14}
          onChange={(event) => set("body", event.target.value)}
          placeholder={
            "Write the guidance the way you would explain it to a careful editor: what to look for, what to leave alone, and what a good result reads like."
          }
          className="max-h-[52vh] text-[12.5px]"
        />
      </Field>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!ready || busy} onClick={save}>
          {skillId ? "Save skill" : "Add skill"}
        </Button>
      </div>
    </div>
  )
}

/**
 * Empty optional fields are omitted rather than sent as empty strings, so the
 * column holds null and the chip knows there is no starter to write.
 */
function normalise(fields: UserSkillInput): UserSkillInput {
  const optional = (value: string | undefined) => {
    const trimmed = value?.trim() ?? ""
    return trimmed.length > 0 ? trimmed : undefined
  }
  return {
    category: fields.category,
    name: fields.name.trim(),
    whenToUse: fields.whenToUse.trim(),
    notFor: optional(fields.notFor),
    starter: optional(fields.starter),
    body: fields.body.trim(),
  }
}

function Field({
  id,
  label,
  hint,
  optional,
  children,
}: {
  id: string
  label: string
  hint?: React.ReactNode
  optional?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className="text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase"
        >
          {label}
          {optional ? (
            <span className="ml-1 font-normal normal-case opacity-70">
              optional
            </span>
          ) : null}
        </label>
        {hint ? (
          <span className="text-[10.5px] text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  )
}
