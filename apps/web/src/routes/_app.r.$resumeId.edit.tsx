import { createFileRoute } from "@tanstack/react-router"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { useEffect } from "react"

import { AssistantPanel } from "@/features/chat/AssistantPanel"
import { PreflightIndicator } from "@/features/export/PreflightIndicator"
import { ConflictBanner } from "@/features/resume/ConflictBanner"
import { EditorPane } from "@/features/resume/editor/EditorPane"
import { useEditorLayout } from "@/features/resume/editor/use-editor-layout"
import { PreviewPane } from "@/features/resume/preview/PreviewPane"
import { useSession } from "@/features/resume/session-context"
import { StatusBarExtra } from "@/features/shell/StatusBar"
import { VersionsPanel } from "@/features/versions/VersionsPanel"

export const Route = createFileRoute("/_app/r/$resumeId/edit")({
  // `?view=versions` swaps the form column for the version list. It is a search
  // param rather than component state so the view survives a reload and the
  // back button closes it.
  validateSearch: (search: Record<string, unknown>): { view?: "versions" } =>
    search.view === "versions" ? { view: "versions" } : {},
  component: EditorScreen,
})

function EditorScreen() {
  const session = useSession()
  const { view } = Route.useSearch()
  const versionsOpen = view === "versions"
  const layout = useEditorLayout({ versionsOpen })
  const { panels, maximized, toggleMaximize, togglePanel } = layout

  // The status bar is rendered above this route, so the preflight control
  // reaches it through the bar's portal host rather than being rendered here.
  // Mounted in both layouts, since the bar outlives the maximize switch.
  const statusExtra = (
    <StatusBarExtra>
      <PreflightIndicator />
    </StatusBarExtra>
  )

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

  const editor = versionsOpen ? (
    <VersionsPanel />
  ) : (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-[22px] pb-[76px]">
      <ConflictBanner />
      <EditorPane pane={layout.pane} />
    </div>
  )

  // A pane lands in three layouts, so its props are written once here rather
  // than three times in the branches below.
  const preview = (compact: boolean) => (
    <PreviewPane
      compact={compact}
      maximized={maximized === "preview"}
      onToggleMaximize={() => toggleMaximize("preview")}
      onClose={() => togglePanel("preview")}
    />
  )
  const assistant = (
    <AssistantPanel
      maximized={maximized === "assistant"}
      onToggleMaximize={() => toggleMaximize("assistant")}
      onClose={() => togglePanel("assistant")}
    />
  )

  const side = layout.splitBoth ? (
    <ResizablePanelGroup orientation="vertical" {...layout.side}>
      {/* Sizes are strings so they are read as percentages; a bare
          number would be interpreted as pixels. */}
      <ResizablePanel id="preview" defaultSize="60" minSize="28">
        {preview(true)}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="assistant" defaultSize="40" minSize="25">
        {assistant}
      </ResizablePanel>
    </ResizablePanelGroup>
  ) : panels.preview ? (
    preview(false)
  ) : (
    assistant
  )

  // Maximizing hands the pane the whole row right of the resume rail: the
  // form column and the side panels stand down until it is restored. The
  // other pane is hidden rather than switched off, so restoring brings back
  // the arrangement that was there before.
  if (maximized) {
    return (
      <div ref={layout.ref} className="relative flex h-full min-h-0">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
          {maximized === "preview" ? preview(false) : assistant}
        </div>
        {statusExtra}
      </div>
    )
  }

  return (
    <div ref={layout.ref} className="relative flex h-full min-h-0">
      {layout.centerOpen && layout.rightOpen ? (
        <ResizablePanelGroup orientation="horizontal" {...layout.columns}>
          {/* Bare numbers are pixels: the editor keeps its old floor and the
              side column opens at its old fixed width. */}
          <ResizablePanel
            id="editor"
            minSize={300}
            className="overflow-hidden bg-paper"
          >
            {editor}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="side"
            defaultSize={panels.preview ? 520 : 400}
            minSize={panels.preview ? 360 : 320}
            maxSize="70"
            className="overflow-hidden bg-canvas"
          >
            {side}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : layout.centerOpen ? (
        <div className="flex min-w-[300px] flex-1 flex-col overflow-hidden bg-paper">
          {editor}
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
          {side}
        </div>
      )}
      {statusExtra}
    </div>
  )
}
