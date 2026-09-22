import { PlusIcon, XIcon } from "@phosphor-icons/react"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { cn } from "@workspace/ui/lib/utils"

import { useSkillNames } from "@/lib/queries"
import { NEW_SKILL_ID, useSkillsWorkspace } from "./workspace"

/**
 * The open skill tabs, across the top of the skills workspace.
 *
 * The same strip as a resume's, with two differences: the first tab is the
 * library itself rather than a fixed screen, and a skill tab can be closed.
 * Closing shows the neighbour, so the strip is never left pointing at a tab
 * that is not there.
 */
export function SkillTabs() {
  const { openIds, close } = useSkillsWorkspace()
  const names = useSkillNames()
  const navigate = useNavigate()
  const params = useParams({ strict: false })
  const activeId = "skillId" in params ? params.skillId : undefined

  function closeTab(id: string) {
    const at = openIds.indexOf(id)
    const next = openIds[at + 1] ?? openIds[at - 1]
    close(id)
    if (id !== activeId) return
    if (next) {
      void navigate({ to: "/skills/$skillId", params: { skillId: next } })
    } else {
      void navigate({ to: "/skills" })
    }
  }

  return (
    <nav
      aria-label="Skills"
      className="flex h-11 flex-none items-stretch gap-0.5 border-b border-border bg-background pr-1"
    >
      <LibraryTab current={activeId === undefined} />

      {openIds.map((id) => {
        const current = id === activeId
        const label = id === NEW_SKILL_ID ? "New skill" : (names[id] ?? "Skill")
        return (
          <div
            key={id}
            className={cn(
              "group/tab flex items-center transition-colors",
              current
                ? "-mb-px bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Link
              to="/skills/$skillId"
              params={{ skillId: id }}
              aria-current={current ? "page" : undefined}
              title={label}
              className="flex h-full max-w-[220px] items-center pr-1 pl-3 font-heading text-[12px] font-semibold"
            >
              <span className="truncate">{label}</span>
            </Link>
            <button
              type="button"
              aria-label={`Close ${label}`}
              onClick={() => closeTab(id)}
              className={cn(
                "mr-1.5 flex size-[18px] flex-none items-center justify-center rounded-[5px] transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover/tab:opacity-100",
                // The tab the URL is on keeps its close in view: it is the one
                // the eye is already on.
                current ? "opacity-70" : "opacity-0"
              )}
            >
              <XIcon className="size-3" weight="bold" />
            </button>
          </div>
        )
      })}

      <Link
        to="/skills/$skillId"
        params={{ skillId: NEW_SKILL_ID }}
        aria-label="Write a new skill"
        title="Write a new skill"
        className="flex items-center px-2.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <PlusIcon className="size-3.5" weight="bold" />
      </Link>
    </nav>
  )
}

/** The library tab: no close button, because the workspace has to show something. */
function LibraryTab({ current }: { current: boolean }) {
  return (
    <Link
      to="/skills"
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex items-center px-3 font-heading text-[12px] font-semibold transition-colors",
        current
          ? "-mb-px bg-card text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      All skills
    </Link>
  )
}
