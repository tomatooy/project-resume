import { useMatchRoute } from "@tanstack/react-router"

/**
 * The four screens of an open resume, in the order the tab strip shows them.
 * The strip, the status bar's Versions shortcut and the rail's row links all
 * read this list, so they cannot disagree about what a screen is or where it
 * lives.
 */
export const RESUME_TABS = [
  { id: "editor", to: "/r/$resumeId/edit", label: "Editor" },
  { id: "versions", to: "/r/$resumeId/versions", label: "Versions" },
  { id: "export", to: "/r/$resumeId/export", label: "Export" },
  { id: "interview", to: "/r/$resumeId/interview", label: "Interview" },
] as const

export type ResumeTab = (typeof RESUME_TABS)[number]

/** The tab the URL is showing. Editor is what a screen with no match falls to. */
export function useResumeTab(resumeId?: string): ResumeTab {
  const matchRoute = useMatchRoute()

  if (!resumeId) return RESUME_TABS[0]
  return (
    RESUME_TABS.find((tab) =>
      matchRoute({ to: tab.to, params: { resumeId } })
    ) ?? RESUME_TABS[0]
  )
}
