import {
  createContext,
  use,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { useResumeState } from "./session-context"

/** One pane of the editor: the fixed Contact or Summary, or a section's id. */
export type PaneKey = string

/** Which pane the editor shows, and the way to open another. */
type ResumeWorkspace = {
  pane: PaneKey
  setPane: (pane: PaneKey) => void
}

const ResumeWorkspaceContext = createContext<ResumeWorkspace | null>(null)

/**
 * The pane the open resume is showing. It sits here rather than in the editor
 * screen because the rail tree switches it too, from every screen of that
 * resume; the session provider is keyed on the resume id, so switching resumes
 * opens Contact again.
 */
export function ResumeWorkspaceProvider({ children }: { children: ReactNode }) {
  const sections = useResumeState((s) => s.doc.sections)
  const [pane, setPane] = useState<PaneKey>("contact")

  // A section deleted while it was open would leave the pane pointing nowhere.
  // The tree can delete one from any screen, so the reset lives with the state.
  useEffect(() => {
    if (pane === "contact" || pane === "summary") return
    if (!sections.some((section) => section.id === pane)) setPane("contact")
  }, [sections, pane])

  const value = useMemo(() => ({ pane, setPane }), [pane])
  return (
    <ResumeWorkspaceContext value={value}>{children}</ResumeWorkspaceContext>
  )
}

export function useResumeWorkspace(): ResumeWorkspace {
  const workspace = use(ResumeWorkspaceContext)
  if (!workspace) {
    throw new Error(
      "useResumeWorkspace must be used inside a ResumeWorkspaceProvider"
    )
  }
  return workspace
}
