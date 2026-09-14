import { createFileRoute, redirect } from "@tanstack/react-router"
import { useEffect } from "react"

import { ConflictBanner } from "@/features/resume/ConflictBanner"
import { EditorPane } from "@/features/resume/editor/EditorPane"
import { useSession } from "@/features/resume/session-context"

/**
 * The Editor tab. Nothing of the shell lives here: the tab strip, the side
 * panes and the preflight control belong to `_app.r.$resumeId.tsx`, the layout
 * route all four screens render into, so this file is the form column and its
 * keyboard shortcuts.
 */
export const Route = createFileRoute("/_app/r/$resumeId/edit")({
  // `?view=versions` used to swap the form column for the version list. That
  // is a route of its own now; the validator stays so `beforeLoad` can still
  // recognize an old link and send it on.
  validateSearch: (search: Record<string, unknown>): { view?: "versions" } =>
    search.view === "versions" ? { view: "versions" } : {},
  beforeLoad: ({ params, search }) => {
    if (search.view === "versions") {
      throw redirect({ to: "/r/$resumeId/versions", params })
    }
  },
  component: EditorScreen,
})

/** The Editor tab: the form column only. */
function EditorScreen() {
  const session = useSession()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        session.select(null)
        return
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z")
        return
      event.preventDefault()
      if (event.shiftKey) session.redo()
      else session.undo()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [session])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-[22px] pb-[76px]">
      <ConflictBanner />
      <EditorPane />
    </div>
  )
}
