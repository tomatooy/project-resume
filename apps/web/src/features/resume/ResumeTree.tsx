import {
  BriefcaseIcon,
  DotsThreeIcon,
  GraduationCapIcon,
  PlusIcon,
  SquaresFourIcon,
  StackIcon,
  TextAlignLeftIcon,
  UserIcon,
  WrenchIcon,
  type Icon,
} from "@phosphor-icons/react"
import type { SectionTypeName } from "@workspace/resume-schema"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { useMatchRoute, useNavigate, useParams } from "@tanstack/react-router"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"

import { addSection, removeNode, setText } from "./actions"
import { RenameSectionDialog } from "./editor/RenameSectionDialog"
import { sectionFlagCount } from "./flags"
import { useResumeState, useSession } from "./session-context"
import { useResumeWorkspace, type PaneKey } from "./workspace"

const SECTION_TYPES: { type: SectionTypeName; label: string }[] = [
  { type: "experience", label: "Experience" },
  { type: "education", label: "Education" },
  { type: "projects", label: "Projects" },
  { type: "skills", label: "Skills" },
  { type: "custom", label: "Custom section" },
]

const SECTION_ICONS: Record<SectionTypeName, Icon> = {
  experience: BriefcaseIcon,
  education: GraduationCapIcon,
  projects: SquaresFourIcon,
  skills: WrenchIcon,
  custom: StackIcon,
}

type TreeEntry = {
  key: PaneKey
  label: string
  icon: Icon
  flags: number
  /** Contact and Summary are fixed document parts; the rest are sections. */
  section: boolean
}

/**
 * The open resume's tree, hung under its row in the rail. It is rendered by
 * the resume's screens rather than by the rail itself, because only they hold
 * the live document; the rail leaves the mount (see `rail-slot`). Everything
 * here is the document, so a rename lands in the tree the moment it lands in
 * the store.
 */
export function ResumeTree() {
  const session = useSession()
  const doc = useResumeState((s) => s.doc)
  const { pane, setPane } = useResumeWorkspace()
  const { resumeId } = useParams({ strict: false })
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const [renaming, setRenaming] = useState<{
    id: string
    title: string
  } | null>(null)

  // Versions is a route of its own now, and the tree has to know it is up so
  // a section click can leave it for the editor.
  const versionsOpen =
    resumeId !== undefined &&
    Boolean(matchRoute({ to: "/r/$resumeId/versions", params: { resumeId } }))
  const onEditor =
    resumeId !== undefined &&
    Boolean(matchRoute({ to: "/r/$resumeId/edit", params: { resumeId } }))

  const entries: TreeEntry[] = [
    {
      key: "contact",
      label: "Contact",
      icon: UserIcon,
      flags: 0,
      section: false,
    },
    {
      key: "summary",
      label: "Summary",
      icon: TextAlignLeftIcon,
      flags: 0,
      section: false,
    },
    ...doc.sections.map((section) => ({
      key: section.id,
      label: section.title,
      icon: SECTION_ICONS[section.type],
      flags: sectionFlagCount(section),
      section: true,
    })),
  ]

  // Open a pane, reaching the editor if the tree is showing beside another
  // screen.
  function open(key: PaneKey) {
    setPane(key)
    if (resumeId && !onEditor) {
      void navigate({ to: "/r/$resumeId/edit", params: { resumeId } })
    }
  }

  return (
    // The guide sits at the open row's icon, so the children read as that
    // row's own file structure.
    <div className="mt-px ml-[22px] flex flex-col border-l border-border pl-1.5">
      {entries.map((entry) => (
        <TreeRow
          key={entry.key}
          entry={entry}
          active={entry.key === pane && !versionsOpen}
          onSelect={() => open(entry.key)}
          onRename={
            entry.section
              ? () => setRenaming({ id: entry.key, title: entry.label })
              : undefined
          }
          onDelete={
            entry.section ? () => removeNode(session, entry.key) : undefined
          }
        />
      ))}

      <AddSectionRow onAdd={open} />

      <RenameSectionDialog
        target={renaming}
        onClose={() => setRenaming(null)}
        onRename={(id, title) => setText(session, id, "title", title)}
      />
    </div>
  )
}

function AddSectionRow({ onAdd }: { onAdd: (id: PaneKey) => void }) {
  const session = useSession()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex h-[26px] w-full items-center gap-1.5 rounded-[6px] pr-1.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PlusIcon className="size-3.5 flex-none opacity-70" />
            <span className="min-w-0 flex-1 truncate text-left">
              Add section
            </span>
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-44">
        {SECTION_TYPES.map(({ type, label }) => (
          <DropdownMenuItem
            key={type}
            onClick={() => {
              const id = addSection(session, type)
              if (id) onAdd(id)
            }}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TreeRow({
  entry,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  entry: TreeEntry
  active: boolean
  onSelect: () => void
  /** Absent on Contact and Summary, which are not sections. */
  onRename?: () => void
  onDelete?: () => void
}) {
  // The flag count and the menu share the row's right end, so the count yields
  // the slot to the menu.
  const yields =
    "transition-opacity group-hover/row:opacity-0 group-has-[:focus-visible]/row:opacity-0"
  const manageable = onRename !== undefined && onDelete !== undefined
  const Glyph = entry.icon

  return (
    <div className="group/row relative">
      <button
        type="button"
        onClick={onSelect}
        title={entry.label}
        className={cn(
          "flex h-[26px] w-full items-center gap-1.5 rounded-sm px-1 text-[12.5px] transition-colors hover:bg-accent",
          active ? "text-foreground bg-accent" : "text-foreground/70"
        )}
      >
        <Glyph className="size-3.5 flex-none opacity-70" />
        <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>
        {entry.flags > 0 ? (
          <span
            className={cn(
              "flex-none rounded-[5px] bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning",
              manageable && yields
            )}
          >
            {entry.flags}
          </span>
        ) : null}
      </button>

      {onRename && onDelete ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`Actions for ${entry.label}`}
                className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-has-[:focus-visible]/row:opacity-100 group-hover/row:opacity-100 hover:bg-muted focus-visible:opacity-100"
              >
                <DotsThreeIcon weight="bold" />
              </button>
            }
          />
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}
