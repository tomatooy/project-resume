import { useId, useState } from "react"
import { toast } from "sonner"
import {
  MAX_SKILL_BODY_CHARS,
  MAX_SKILL_DESCRIPTION_CHARS,
  MAX_SKILL_NAME_CHARS,
  MAX_SKILL_NOT_FOR_CHARS,
  MAX_SKILL_STARTER_CHARS,
  MAX_SKILL_WHEN_TO_USE_CHARS,
  SkillCategorySchema,
  UserSkillInputSchema,
  type SkillDraft,
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
export const BLANK_SKILL: SkillDraft = {
  category: "editor",
  name: "",
  description: "",
  body: "",
}

const CATEGORY_LABELS: Record<UserSkillInput["category"], string> = {
  editor: "Editor",
  interview: "Interview",
}

/**
 * Writing or editing one skill, in the tab that opened it.
 *
 * The form holds the name, description, body and optional usage guidance.
 * Skill text cannot change the patch contract.
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
  initial: SkillDraft
  /** The saved id, which for a new skill is the tab's new address. */
  onSaved: (id: string) => void
  onCancel: () => void
}) {
  const [fields, setFields] = useState<SkillDraft>(initial)
  const [submitted, setSubmitted] = useState(false)
  const ids = useId()
  const create = useCreateUserSkill()
  const update = useUpdateUserSkill()
  const busy = create.isPending || update.isPending

  const validation = UserSkillInputSchema.safeParse(fields)
  function errorFor(field: keyof SkillDraft): string | undefined {
    if (!submitted || validation.success) return undefined
    return validation.error.issues.find((issue) => issue.path[0] === field)
      ?.message
  }

  function set<K extends keyof SkillDraft>(key: K, value: SkillDraft[K]) {
    setFields((current) => ({ ...current, [key]: value }))
  }

  function save() {
    setSubmitted(true)
    if (!validation.success) return
    const input = validation.data
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
    <form
      noValidate
      className="flex min-w-0 flex-col gap-3.5"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <Field
        id={`${ids}-name`}
        error={errorFor("name")}
        label="Name"
        hint={
          <CharacterCount value={fields.name} maximum={MAX_SKILL_NAME_CHARS} />
        }
      >
        <Input
          id={`${ids}-name`}
          aria-invalid={Boolean(errorFor("name"))}
          aria-describedby={errorFor("name") ? `${ids}-name-error` : undefined}
          value={fields.name}
          onChange={(event) => set("name", event.target.value)}
          placeholder="Tighten the summary"
        />
      </Field>

      <Field
        id={`${ids}-description`}
        label="Description"
        hint={
          <CharacterCount
            value={fields.description}
            maximum={MAX_SKILL_DESCRIPTION_CHARS}
          />
        }
        error={errorFor("description")}
      >
        <Textarea
          id={`${ids}-description`}
          value={fields.description}
          rows={3}
          aria-invalid={Boolean(errorFor("description"))}
          aria-describedby={
            errorFor("description") ? `${ids}-description-error` : undefined
          }
          onChange={(event) => set("description", event.target.value)}
          placeholder="Describe what this skill does."
          className="field-sizing-fixed min-w-0 resize-y"
        />
      </Field>

      <Field id={`${ids}-category`} label="Group" error={errorFor("category")}>
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
            aria-invalid={Boolean(errorFor("category"))}
            aria-describedby={
              errorFor("category") ? `${ids}-category-error` : undefined
            }
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
        error={errorFor("whenToUse")}
        label="When to use it"
        optional
        hint={
          <CharacterCount
            value={fields.whenToUse}
            maximum={MAX_SKILL_WHEN_TO_USE_CHARS}
          />
        }
      >
        <Input
          id={`${ids}-when`}
          aria-invalid={Boolean(errorFor("whenToUse"))}
          aria-describedby={
            errorFor("whenToUse") ? `${ids}-when-error` : undefined
          }
          value={fields.whenToUse ?? ""}
          onChange={(event) => set("whenToUse", event.target.value)}
          placeholder="The summary runs long and the user asks for a sharper opening."
        />
      </Field>

      <Field
        id={`${ids}-not-for`}
        error={errorFor("notFor")}
        label="Not for"
        optional
        hint={
          <CharacterCount
            value={fields.notFor}
            maximum={MAX_SKILL_NOT_FOR_CHARS}
          />
        }
      >
        <Input
          id={`${ids}-not-for`}
          aria-invalid={Boolean(errorFor("notFor"))}
          aria-describedby={
            errorFor("notFor") ? `${ids}-not-for-error` : undefined
          }
          value={fields.notFor ?? ""}
          onChange={(event) => set("notFor", event.target.value)}
          placeholder="Cutting length, or adding content."
        />
      </Field>

      <Field
        id={`${ids}-starter`}
        error={errorFor("starter")}
        label="Starter"
        optional
        hint={
          <CharacterCount
            value={fields.starter}
            maximum={MAX_SKILL_STARTER_CHARS}
          />
        }
      >
        <Input
          id={`${ids}-starter`}
          aria-invalid={Boolean(errorFor("starter"))}
          aria-describedby={
            errorFor("starter") ? `${ids}-starter-error` : undefined
          }
          value={fields.starter ?? ""}
          onChange={(event) => set("starter", event.target.value)}
          placeholder="Sharpen my summary."
        />
      </Field>

      <Field
        id={`${ids}-body`}
        error={errorFor("body")}
        label="Body"
        hint={
          <CharacterCount value={fields.body} maximum={MAX_SKILL_BODY_CHARS} />
        }
      >
        <Textarea
          id={`${ids}-body`}
          aria-invalid={Boolean(errorFor("body"))}
          aria-describedby={errorFor("body") ? `${ids}-body-error` : undefined}
          value={fields.body}
          rows={14}
          onChange={(event) => set("body", event.target.value)}
          placeholder={
            "Write the guidance the way you would explain it to a careful editor: what to look for, what to leave alone, and what a good result reads like."
          }
          className="field-sizing-fixed max-h-[52vh] min-w-0 resize-y text-[12.5px]"
        />
      </Field>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {skillId ? "Save skill" : "Add skill"}
        </Button>
      </div>
    </form>
  )
}

function CharacterCount({
  value,
  maximum,
}: {
  value: string | undefined
  maximum: number
}) {
  const count = value?.trim().length ?? 0
  return (
    <span className={cn("tabular-nums", count > maximum && "text-destructive")}>
      {count.toLocaleString("en-US")} / {maximum.toLocaleString("en-US")}
    </span>
  )
}

function Field({
  id,
  label,
  hint,
  optional,
  error,
  children,
}: {
  id: string
  label: string
  hint?: React.ReactNode
  optional?: boolean
  error?: string
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
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-[11.5px] text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
