import {
  ClockCounterClockwiseIcon,
  FileTextIcon,
  PlusIcon,
  SparkleIcon,
} from "@phosphor-icons/react"
import type { SectionTypeName } from "@workspace/resume-schema"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Switch } from "@workspace/ui/components/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useId, type ReactNode } from "react"

import { useResumeState, useSession } from "../session-context"
import { sectionFlagCount } from "../flags"
import { addSection } from "../actions"

export type PaneKey = string

const SECTION_TYPES: { type: SectionTypeName; label: string }[] = [
  { type: "experience", label: "Experience" },
  { type: "education", label: "Education" },
  { type: "projects", label: "Projects" },
  { type: "skills", label: "Skills" },
  { type: "custom", label: "Custom section" },
]

type RailEntry = {
  key: PaneKey
  label: string
  initial: string
  flags: number
}

export function SectionRail({
  active,
  onSelect,
  collapsed,
  panels,
  onTogglePanel,
  versionsOpen,
  onToggleVersions,
}: {
  active: PaneKey
  onSelect: (key: PaneKey) => void
  collapsed: boolean
  panels: { preview: boolean; assistant: boolean }
  onTogglePanel: (panel: "preview" | "assistant") => void
  versionsOpen: boolean
  onToggleVersions: () => void
}) {
  const session = useSession()
  const doc = useResumeState((s) => s.doc)

  const entries: RailEntry[] = [
    { key: "contact", label: "Contact", initial: "Co", flags: 0 },
    { key: "summary", label: "Summary", initial: "Su", flags: 0 },
    ...doc.sections.map((section) => ({
      key: section.id,
      label: section.title,
      initial: section.title.slice(0, 2),
      flags: sectionFlagCount(section),
    })),
  ]

  return (
    <div
      className={cn(
        "flex-none overflow-y-auto border-r border-border bg-paper py-4",
        collapsed ? "w-[50px] px-[7px]" : "w-[200px] px-2.5"
      )}
    >
      {!collapsed ? (
        <div className="flex items-center gap-2 px-0.5 pb-3">
          <span className="text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
            Sections
          </span>
        </div>
      ) : null}

      <div className="flex flex-col gap-[3px]">
        {entries.map((entry) => (
          <RailButton
            key={entry.key}
            entry={entry}
            active={!versionsOpen && entry.key === active}
            collapsed={collapsed}
            onClick={() => onSelect(entry.key)}
          />
        ))}
      </div>

      {!collapsed ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="mt-2.5 h-8 w-full rounded-[7px] border border-dashed border-border text-[12px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                + Add section
              </button>
            }
          />
          <DropdownMenuContent align="start" className="w-44">
            {SECTION_TYPES.map(({ type, label }) => (
              <DropdownMenuItem
                key={type}
                onClick={() => {
                  const id = addSection(session, type)
                  if (id) onSelect(id)
                }}
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Add section"
                onClick={() => {
                  const id = addSection(session, "custom")
                  if (id) onSelect(id)
                }}
                className="mt-2.5 flex h-8 w-full items-center justify-center rounded-[7px] border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <PlusIcon className="size-3.5" />
              </button>
            }
          />
          <TooltipContent side="right">Add section</TooltipContent>
        </Tooltip>
      )}

      <div className="mt-[18px] flex flex-col gap-1 border-t border-border pt-3.5">
        {!collapsed ? (
          <span className="px-0.5 pb-[7px] text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
            Side panels
          </span>
        ) : null}

        <PanelSwitch
          label="Preview"
          icon={<FileTextIcon className="size-3.75 flex-none" />}
          on={panels.preview}
          collapsed={collapsed}
          onToggle={() => onTogglePanel("preview")}
        />
        <PanelSwitch
          label="Assistant"
          icon={<SparkleIcon className="size-[15px] flex-none" />}
          on={panels.assistant}
          collapsed={collapsed}
          onToggle={() => onTogglePanel("assistant")}
        />

        {/* Not a switch: it is not a panel, it takes the form's place in the
            middle column until it is switched back off. */}
        <VersionsButton
          on={versionsOpen}
          collapsed={collapsed}
          onClick={onToggleVersions}
        />
      </div>
    </div>
  )
}

function VersionsButton({
  on,
  collapsed,
  onClick,
}: {
  on: boolean
  collapsed: boolean
  onClick: () => void
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "flex h-8 w-full items-center gap-[9px] rounded-[7px] text-[12.5px] transition-colors hover:bg-muted",
        collapsed ? "justify-center px-0" : "px-2",
        on
          ? "bg-primary/9 font-semibold text-foreground"
          : "font-medium text-foreground/70"
      )}
    >
      <ClockCounterClockwiseIcon className="size-[15px] flex-none" />
      {!collapsed ? (
        <span className="flex-1 truncate text-left">Versions</span>
      ) : null}
    </button>
  )

  if (!collapsed) return button

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="right">Versions</TooltipContent>
    </Tooltip>
  )
}

function RailButton({
  entry,
  active,
  collapsed,
  onClick,
}: {
  entry: RailEntry
  active: boolean
  collapsed: boolean
  onClick: () => void
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? entry.label : undefined}
      className={cn(
        "flex h-[34px] w-full items-center gap-[9px] rounded-[7px] text-[12.5px] transition-colors",
        collapsed ? "justify-center px-1.5" : "px-[9px]",
        active
          ? "bg-primary/9 font-semibold text-primary-deep"
          : "font-medium text-foreground/80 hover:bg-muted"
      )}
    >
      {collapsed ? (
        <span
          className={cn(
            "relative flex-none text-[11px] font-bold tracking-[-0.02em]",
            active ? "text-primary-deep" : "text-muted-foreground"
          )}
        >
          {entry.initial}
          {entry.flags > 0 ? <FlagDot /> : null}
        </span>
      ) : (
        <>
          <span className="flex-1 truncate text-left">{entry.label}</span>
          {entry.flags > 0 ? (
            <span className="flex-none rounded-[5px] bg-flag/15 px-1.5 py-0.5 text-[10px] font-semibold text-flag-foreground">
              {entry.flags}
            </span>
          ) : null}
        </>
      )}
    </button>
  )

  if (!collapsed) return button

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="right">
        {entry.label}
        {entry.flags > 0 ? ` · ${entry.flags} to improve` : ""}
      </TooltipContent>
    </Tooltip>
  )
}

function FlagDot() {
  return (
    <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-flag shadow-[0_0_0_1.5px_var(--paper)]" />
  )
}

/**
 * A side panel is on or off, so the rail states it as a switch rather than a
 * pressed button. The switch renders as a native button so the row's label can
 * point at it with `htmlFor`, making everything but the switch a hit target.
 */
function PanelSwitch({
  label,
  icon,
  on,
  collapsed,
  onToggle,
}: {
  label: string
  icon?: ReactNode
  on: boolean
  collapsed: boolean
  onToggle: () => void
}) {
  const id = useId()

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Switch
              size="sm"
              checked={on}
              onCheckedChange={onToggle}
              aria-label={label}
              className="mx-auto my-[9px]"
            />
          }
        />
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div
      className={cn(
        "flex h-8 w-full items-center gap-[9px] rounded-[7px] px-2 text-[12.5px] transition-colors hover:bg-muted",
        on ? "text-foreground" : "text-foreground/70"
      )}
    >
      <label
        htmlFor={id}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-[9px]"
      >
        {icon}
        <span className="truncate">{label}</span>
      </label>
      <Switch
        id={id}
        nativeButton
        size="sm"
        checked={on}
        onCheckedChange={onToggle}
      />
    </div>
  )
}
