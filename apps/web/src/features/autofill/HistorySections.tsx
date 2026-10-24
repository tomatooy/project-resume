import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretDownIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { type Profile, PROFILE_HISTORY_LIMIT } from "@workspace/autofill"
import { type Bullet, formatRange, newId } from "@workspace/resume-schema"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Textarea } from "@workspace/ui/components/textarea"
import { type ReactNode, useState } from "react"

import {
  ChipInput,
  EndDateInput,
  MonthInput,
} from "@/features/resume/editor/fields"
import { Field, type FieldControl, fieldId, Grid, TextField } from "./fields"
import type { SectionProps } from "./sections"

const NOTE = "text-[12px] leading-[1.55] text-muted-foreground"

function EntryList<T extends { id: string }>({
  value,
  onChange,
  create,
  title,
  summary,
  addLabel,
  description,
  empty,
  children,
}: {
  value: T[]
  onChange: (next: T[]) => void
  create: () => T
  title: (entry: T) => string
  summary: (entry: T) => string
  addLabel: string
  description: string
  empty: string
  children: (
    entry: T,
    index: number,
    patch: (next: Partial<T>) => void
  ) => ReactNode
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  function move(index: number, offset: number) {
    const next = [...value]
    const [entry] = next.splice(index, 1)
    if (!entry) return
    next.splice(index + offset, 0, entry)
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-3">
      <p className={NOTE}>{description}</p>
      {value.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-border p-4 text-[12px] text-muted-foreground">
          {empty} Autofill uses the selected resume until you add an entry.
        </p>
      ) : null}
      {value.map((entry, index) => (
        <Collapsible
          key={entry.id}
          open={openId === entry.id}
          onOpenChange={(open) => setOpenId(open ? entry.id : null)}
          className="rounded-[10px] border border-border bg-card"
        >
          <div className="flex items-center gap-1 px-3 py-2">
            <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 text-left focus-visible:outline-2 focus-visible:outline-ring">
              <CaretDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-180" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold">
                  {title(entry)}
                </span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  {summary(entry)}
                </span>
              </span>
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Move ${title(entry)} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Move ${title(entry)} down`}
              disabled={index === value.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDownIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${title(entry)}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={() =>
                onChange(value.filter((row) => row.id !== entry.id))
              }
            >
              <TrashIcon />
            </Button>
          </div>
          <CollapsibleContent>
            <div className="mx-4 flex flex-col gap-4 border-t border-border py-4">
              {children(entry, index, (next) =>
                onChange(
                  value.map((row) =>
                    row.id === entry.id ? { ...row, ...next } : row
                  )
                )
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={value.length >= PROFILE_HISTORY_LIMIT}
        onClick={() => {
          const entry = create()
          onChange([...value, entry])
          setOpenId(entry.id)
        }}
      >
        <PlusIcon />
        {addLabel}
      </Button>
    </div>
  )
}

export function Experience({ profile, set, control }: SectionProps) {
  return (
    <EntryList
      value={profile.experience}
      onChange={(next) => set("experience", next)}
      create={(): Profile["experience"][number] => ({
        id: newId("exp"),
        kind: "experience",
        company: "",
        role: "",
        start: "",
        end: "",
        bullets: [],
      })}
      title={(entry) => entry.role || entry.company || "New experience"}
      summary={(entry) =>
        [entry.company, formatRange(entry.start, entry.end)]
          .filter(Boolean)
          .join(" · ")
      }
      addLabel="Add experience"
      description="Keep your current or most recent role first. Autofill uses it for employer and job title, and all roles for total experience."
      empty="No work experience saved."
    >
      {(entry, index, patch) => {
        const path = `experience.${index}`
        return (
          <>
            <Grid>
              <TextField
                control={control}
                path={`${path}.company`}
                label="Company"
                maxLength={200}
                message="Enter a company name."
                value={entry.company}
                onChange={(company) => patch({ company })}
              />
              <TextField
                control={control}
                path={`${path}.role`}
                label="Job title"
                maxLength={200}
                message="Enter a job title."
                value={entry.role}
                onChange={(role) => patch({ role })}
              />
              <TextField
                control={control}
                path={`${path}.location`}
                label="Location"
                optional
                maxLength={200}
                value={entry.location ?? ""}
                onChange={(location) => patch({ location })}
              />
            </Grid>
            <Grid>
              <MonthInput
                label="Start date"
                value={entry.start}
                error={
                  control.invalid(`${path}.start`)
                    ? "Choose a start month."
                    : undefined
                }
                onCommit={(start) => {
                  patch({ start })
                  control.touch(`${path}.start`)
                }}
              />
              <EndDateInput
                label="End date"
                value={entry.end}
                error={
                  control.invalid(`${path}.end`)
                    ? "Choose an end month or Present."
                    : undefined
                }
                onCommit={(end) => {
                  patch({ end })
                  control.touch(`${path}.end`)
                }}
              />
            </Grid>
            <Achievements
              value={entry.bullets}
              onChange={(bullets) => patch({ bullets })}
              path={`${path}.bullets`}
              control={control}
              limit={20}
            />
          </>
        )
      }}
    </EntryList>
  )
}

export function Education({ profile, set, control }: SectionProps) {
  return (
    <EntryList
      value={profile.education}
      onChange={(next) => set("education", next)}
      create={(): Profile["education"][number] => ({
        id: newId("edu"),
        kind: "education",
        school: "",
        bullets: [],
      })}
      title={(entry) => entry.school || "New education"}
      summary={(entry) =>
        [entry.degree, entry.field, formatRange(entry.start, entry.end)]
          .filter(Boolean)
          .join(" · ")
      }
      addLabel="Add education"
      description="Put the education you want autofill to use first. Keep degree, field of study and graduation date together for each school."
      empty="No education saved."
    >
      {(entry, index, patch) => {
        const path = `education.${index}`
        return (
          <>
            <Grid>
              <TextField
                control={control}
                path={`${path}.school`}
                label="School"
                maxLength={200}
                message="Enter a school name."
                value={entry.school}
                onChange={(school) => patch({ school })}
              />
              <TextField
                control={control}
                path={`${path}.degree`}
                label="Degree"
                optional
                maxLength={200}
                value={entry.degree ?? ""}
                onChange={(degree) => patch({ degree })}
              />
              <TextField
                control={control}
                path={`${path}.field`}
                label="Field of study"
                optional
                maxLength={200}
                value={entry.field ?? ""}
                onChange={(field) => patch({ field })}
              />
            </Grid>
            <Grid>
              <MonthInput
                label="Start date (optional)"
                value={entry.start ?? ""}
                onCommit={(start) => patch({ start: start || undefined })}
              />
              <EndDateInput
                label="Graduation date (optional)"
                value={entry.end}
                onCommit={(end) => patch({ end: end || undefined })}
              />
            </Grid>
            <Achievements
              value={entry.bullets}
              onChange={(bullets) => patch({ bullets })}
              path={`${path}.bullets`}
              control={control}
              limit={10}
            />
          </>
        )
      }}
    </EntryList>
  )
}

export function Skills({ profile, set, control }: SectionProps) {
  return (
    <EntryList
      value={profile.skills}
      onChange={(next) => set("skills", next)}
      create={(): Profile["skills"][number] => ({
        id: newId("skl"),
        kind: "skills",
        label: "",
        skills: [],
      })}
      title={(entry) => entry.label || "New skill group"}
      summary={(entry) => entry.skills.join(", ") || "No skills added"}
      addLabel="Add skill group"
      description="Group your skills, such as languages or tools. Autofill uses the skills from every group."
      empty="No skills saved."
    >
      {(entry, index, patch) => {
        const path = `skills.${index}`
        return (
          <>
            <TextField
              control={control}
              path={`${path}.label`}
              label="Group name"
              maxLength={200}
              message="Name this skill group."
              placeholder="Languages, tools, or other skills"
              value={entry.label}
              onChange={(label) => patch({ label })}
            />
            <ChipInput
              label="Skills"
              values={entry.skills}
              error={
                control.invalid(`${path}.skills`)
                  ? "Use up to 50 skills, each 200 characters or fewer."
                  : undefined
              }
              onCommit={(skills) => {
                patch({ skills })
                control.touch(`${path}.skills`)
              }}
            />
          </>
        )
      }}
    </EntryList>
  )
}

function Achievements({
  value,
  onChange,
  path,
  control,
  limit,
}: {
  value: Bullet[]
  onChange: (next: Bullet[]) => void
  path: string
  control: FieldControl
  limit: number
}) {
  return (
    <div className="flex flex-col gap-3">
      {value.map((bullet, index) => {
        const textPath = `${path}.${index}.text`
        const id = fieldId(textPath)
        const invalid = control.invalid(textPath)
        return (
          <div key={bullet.id} className="flex items-start gap-2">
            <Field
              id={id}
              label={`Achievement ${index + 1}`}
              optional
              className="flex-1"
              error={invalid ? "Use 2,000 characters or fewer." : undefined}
            >
              <Textarea
                id={id}
                value={bullet.text}
                maxLength={2000}
                rows={2}
                onChange={(event) =>
                  onChange(
                    value.map((row) =>
                      row.id === bullet.id
                        ? { ...row, text: event.target.value }
                        : row
                    )
                  )
                }
                onBlur={() => control.touch(textPath)}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `${id}-error` : undefined}
              />
            </Field>
            <Button
              variant="ghost"
              size="icon-xs"
              className="mt-6 text-muted-foreground hover:text-destructive"
              aria-label={`Remove achievement ${index + 1}`}
              onClick={() =>
                onChange(value.filter((row) => row.id !== bullet.id))
              }
            >
              <TrashIcon />
            </Button>
          </div>
        )
      })}
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        disabled={value.length >= limit}
        onClick={() => onChange([...value, { id: newId("bul"), text: "" }])}
      >
        <PlusIcon />
        Add achievement
      </Button>
    </div>
  )
}
