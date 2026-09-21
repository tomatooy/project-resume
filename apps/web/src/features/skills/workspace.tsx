import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react"

/**
 * The id a skill tab carries before the skill exists.
 *
 * The editor is a tab like any other: writing a new skill opens one, and it
 * becomes a real id when the form saves. Custom ids are `usr_…`, so nothing
 * can collide with this word.
 */
export const NEW_SKILL_ID = "new"

type SkillsWorkspace = {
  /** The skill tabs that are open, in the order they were opened. */
  openIds: string[]
  /** A tab that is open stays open; the route calls this on mount. */
  ensure: (id: string) => void
  close: (id: string) => void
}

const SkillsWorkspaceContext = createContext<SkillsWorkspace | null>(null)

export function useSkillsWorkspace(): SkillsWorkspace {
  const workspace = use(SkillsWorkspaceContext)
  if (!workspace) {
    throw new Error("useSkillsWorkspace must be used inside SkillsWorkspace")
  }
  return workspace
}

/**
 * Which skill tabs are open.
 *
 * React state rather than a module store, and it lives under the `/skills`
 * layout, so it is per-request on the server and per-visit in the browser.
 * What a tab holds is a URL, so the strip can rebuild itself from one: this
 * only remembers the ones the user opened on the way.
 */
export function SkillsWorkspaceProvider({ children }: { children: ReactNode }) {
  const [openIds, setOpenIds] = useState<string[]>([])

  const ensure = useCallback((id: string) => {
    setOpenIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
  }, [])

  const close = useCallback((id: string) => {
    setOpenIds((ids) => ids.filter((open) => open !== id))
  }, [])

  const value = useMemo(
    () => ({ openIds, ensure, close }),
    [openIds, ensure, close]
  )

  return (
    <SkillsWorkspaceContext value={value}>{children}</SkillsWorkspaceContext>
  )
}
