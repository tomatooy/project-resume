import { CaretDownIcon, CaretUpIcon, TrashIcon } from "@phosphor-icons/react"
import { formatRange, NO_ERRORS, type Item } from "@workspace/resume-schema"
import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"

import { removeNode, setFields, setText } from "../actions"
import { itemFlagCount } from "../flags"
import { useResumeState, useSession } from "../session-context"
import { ChipInput, EndDateInput, MonthInput, TextInput } from "./fields"
import { BulletList } from "./BulletList"

function headline(item: Item): { title: string; subtitle: string } {
  switch (item.kind) {
    case "experience":
      return {
        title: item.role,
        subtitle: [
          item.company,
          formatRange(item.start, item.end),
          item.location,
        ]
          .filter(Boolean)
          .join(" · "),
      }
    case "education":
      return {
        title: item.school,
        subtitle: [
          [item.degree, item.field].filter(Boolean).join(", "),
          formatRange(item.start, item.end),
        ]
          .filter(Boolean)
          .join(" · "),
      }
    case "project":
      return {
        title: item.name,
        subtitle: item.url ?? formatRange(item.start, item.end),
      }
    case "skills":
      return { title: item.label, subtitle: `${item.skills.length} listed` }
    case "custom":
      return {
        title: item.title,
        subtitle: [item.subtitle, formatRange(item.start, item.end)]
          .filter(Boolean)
          .join(" · "),
      }
  }
}

/** Start and End share a row only when the cell fits both controls: the End
 *  picker carries a checkbox beside it, so a narrow cell overflows. */
const DATE_PAIR = "grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-2.5"

/** Two field columns need this much room, and the card, not the window, is
 *  what has it (the form pane is resizable and the side panels take width). */
const TWO_UP = "@min-[24rem]:grid-cols-2"

/** An entry that spans both columns, which exist only above `TWO_UP`. */
const FULL_WIDTH = "@min-[24rem]:col-span-2"

export function ItemCard({
  item,
  open,
  onToggle,
  handle,
}: {
  item: Item
  open: boolean
  onToggle: () => void
  handle: ReactNode
}) {
  const session = useSession()
  const selectedNodeId = useResumeState((s) => s.selectedNodeId)
  const errors = useResumeState((s) => s.validity.byNode[item.id] ?? NO_ERRORS)
  const flags = itemFlagCount(item)
  const { title, subtitle } = headline(item)
  const selected = selectedNodeId === item.id

  return (
    <div
      className={cn(
        "@container rounded-[10px] border bg-paper transition-shadow",
        open
          ? "border-primary/35 shadow-[0_6px_20px_-14px_oklch(0.145_0_0/25%)]"
          : "border-border",
        selected && !open && "ring-2 ring-primary/25"
      )}
    >
      <div className="flex items-center gap-3 px-2 py-3.5 pr-4">
        {handle}

        <button
          type="button"
          onClick={() => {
            session.select(item.id)
            onToggle()
          }}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-heading text-[13.5px] font-semibold tracking-[-0.01em]">
              {title || "Untitled"}
            </span>
            <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
              {subtitle}
            </span>
          </span>

          {flags > 0 ? (
            <span className="flex-none rounded-md bg-flag/14 px-2 py-[3px] text-[10.5px] font-semibold text-flag-foreground">
              {flags} to improve
            </span>
          ) : null}
        </button>

        <button
          type="button"
          aria-label="Delete entry"
          onClick={() => removeNode(session, item.id)}
          className="flex size-6 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
        >
          <TrashIcon className="size-3.5" />
        </button>

        <span className="w-3 flex-none text-center text-muted-foreground">
          {open ? (
            <CaretUpIcon className="size-3" />
          ) : (
            <CaretDownIcon className="size-3" />
          )}
        </span>
      </div>

      {open ? (
        <div className="px-4 pb-4">
          <div
            className={cn(
              "grid grid-cols-1 gap-2.5 border-t border-border py-3.5",
              TWO_UP
            )}
          >
            <ItemFields item={item} errors={errors} />
          </div>

          {item.kind === "skills" ? (
            <ChipInput
              label="Skills"
              values={item.skills}
              error={errors.skills}
              onCommit={(skills) => setFields(session, item.id, { skills })}
            />
          ) : (
            <>
              <div className="mb-2 text-[11px] font-medium text-muted-foreground">
                Achievements
              </div>
              <BulletList itemId={item.id} bullets={item.bullets} />
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

function ItemFields({
  item,
  errors,
}: {
  item: Item
  errors: Record<string, string>
}) {
  const session = useSession()
  const text = (field: string, value: string) =>
    setText(session, item.id, field, value)
  const fields = (patch: Record<string, unknown>) =>
    setFields(session, item.id, patch)

  switch (item.kind) {
    case "experience":
      return (
        <>
          <TextInput
            label="Job title"
            value={item.role}
            error={errors.role}
            onCommit={(v) => text("role", v)}
          />
          <TextInput
            label="Company"
            value={item.company}
            error={errors.company}
            onCommit={(v) => text("company", v)}
          />
          <TextInput
            label="Location"
            value={item.location ?? ""}
            error={errors.location}
            onCommit={(v) => text("location", v)}
          />
          <div className={DATE_PAIR}>
            <MonthInput
              label="Start"
              value={item.start}
              error={errors.start}
              onCommit={(v) => fields({ start: v })}
            />
            <EndDateInput
              value={item.end}
              error={errors.end}
              onCommit={(v) => fields({ end: v })}
            />
          </div>
        </>
      )
    case "education":
      return (
        <>
          <TextInput
            label="School"
            value={item.school}
            error={errors.school}
            onCommit={(v) => text("school", v)}
          />
          <TextInput
            label="Degree"
            value={item.degree ?? ""}
            error={errors.degree}
            onCommit={(v) => text("degree", v)}
          />
          <TextInput
            label="Field of study"
            value={item.field ?? ""}
            error={errors.field}
            onCommit={(v) => text("field", v)}
          />
          <div className={cn(DATE_PAIR, FULL_WIDTH)}>
            <MonthInput
              label="Start"
              value={item.start ?? ""}
              error={errors.start}
              onCommit={(v) => fields({ start: v || undefined })}
            />
            <EndDateInput
              value={item.end}
              error={errors.end}
              onCommit={(v) => fields({ end: v || undefined })}
            />
          </div>
        </>
      )
    case "project":
      return (
        <>
          <TextInput
            label="Project"
            value={item.name}
            error={errors.name}
            onCommit={(v) => text("name", v)}
          />
          <TextInput
            label="Link"
            value={item.url ?? ""}
            error={errors.url}
            placeholder="https://"
            onCommit={(v) => fields({ url: v || undefined })}
          />
          <div className={cn(DATE_PAIR, FULL_WIDTH)}>
            <MonthInput
              label="Start"
              value={item.start ?? ""}
              error={errors.start}
              onCommit={(v) => fields({ start: v || undefined })}
            />
            <EndDateInput
              value={item.end}
              error={errors.end}
              onCommit={(v) => fields({ end: v || undefined })}
            />
          </div>
        </>
      )
    case "skills":
      return (
        <TextInput
          label="Group name"
          className={FULL_WIDTH}
          value={item.label}
          error={errors.label}
          onCommit={(v) => text("label", v)}
        />
      )
    case "custom":
      return (
        <>
          <TextInput
            label="Title"
            value={item.title}
            error={errors.title}
            onCommit={(v) => text("title", v)}
          />
          <TextInput
            label="Subtitle"
            value={item.subtitle ?? ""}
            error={errors.subtitle}
            onCommit={(v) => text("subtitle", v)}
          />
          <div className={cn(DATE_PAIR, FULL_WIDTH)}>
            <MonthInput
              label="Start"
              value={item.start ?? ""}
              error={errors.start}
              onCommit={(v) => fields({ start: v || undefined })}
            />
            <EndDateInput
              value={item.end}
              error={errors.end}
              onCommit={(v) => fields({ end: v || undefined })}
            />
          </div>
        </>
      )
  }
}
