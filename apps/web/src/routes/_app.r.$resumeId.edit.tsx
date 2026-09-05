import { createFileRoute } from "@tanstack/react-router"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useResizableGroupRef,
} from "@workspace/ui/components/resizable"
import { useEffect, useState } from "react"
import { z } from "zod"

import { AssistantPanel } from "@/features/chat/AssistantPanel"
import { ConflictBanner } from "@/features/resume/ConflictBanner"
import { EditorPane } from "@/features/resume/editor/EditorPane"
import { SectionRail, type PaneKey } from "@/features/resume/editor/SectionRail"
import { PreviewPane } from "@/features/resume/preview/PreviewPane"
import { useResumeState, useSession } from "@/features/resume/session-context"
import { VersionsPanel } from "@/features/versions/VersionsPanel"
import { useElementWidth } from "@/lib/use-element-width"
import { useLocalStorage } from "@/lib/use-local-storage"

export const Route = createFileRoute("/_app/r/$resumeId/edit")({
  // `?view=versions` swaps the form column for the version list. It is a search
  // param rather than component state so the view survives a reload and the
  // back button closes it.
  validateSearch: (search: Record<string, unknown>): { view?: "versions" } =>
    search.view === "versions" ? { view: "versions" } : {},
  component: EditorScreen,
})

/** Below this the section rail collapses to initials and the form yields. */
/** Stored preferences. Module-level so the storage hook sees one schema value. */
const Panels = z.object({ preview: z.boolean(), assistant: z.boolean() })
const Split = z.record(z.string(), z.number()).optional()

const VERY_TIGHT = 980

function EditorScreen() {
  const session = useSession()
  const doc = useResumeState((s) => s.doc)
  const { ref, width } = useElementWidth()
  const { view } = Route.useSearch()
  const navigate = Route.useNavigate()

  const [pane, setPane] = useState<PaneKey>("contact")
  const [panels, setPanels] = useLocalStorage("resume-studio.panels", Panels, {
    preview: true,
    assistant: false,
  })
  const [layout, setLayout] = useLocalStorage(
    "resume-studio.right-split",
    Split,
    undefined
  )
  const [columns, setColumns] = useLocalStorage(
    "resume-studio.column-split",
    Split,
    undefined
  )
  const columnsRef = useResizableGroupRef()

  // Storage is read after mount, so a saved split lands after the group has
  // already taken its defaults. Push it in instead of remounting the panes.
  useEffect(() => {
    if (columns) columnsRef.current?.setLayout(columns)
  }, [columns, columnsRef])

  // A section deleted while it was open would leave the pane pointing nowhere.
  useEffect(() => {
    if (pane === "contact" || pane === "summary") return
    if (!doc.sections.some((section) => section.id === pane)) setPane("contact")
  }, [doc.sections, pane])

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

  const veryTight = width < VERY_TIGHT
  const rightOpen = panels.preview || panels.assistant
  const splitBoth = panels.preview && panels.assistant
  const versionsOpen = view === "versions"
  // The form yields to the side panels when there is no room for both, but
  // versions was asked for outright, so it always gets the column.
  const centerOpen = versionsOpen || !(veryTight && rightOpen)

  const togglePanel = (panel: "preview" | "assistant") =>
    setPanels((current) => ({ ...current, [panel]: !current[panel] }))

  const toggleVersions = () =>
    navigate({ search: versionsOpen ? {} : { view: "versions" } })

  const editor = versionsOpen ? (
    <VersionsPanel />
  ) : (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-[22px] pb-[76px]">
      <ConflictBanner />
      <EditorPane pane={pane} />
    </div>
  )

  const side = splitBoth ? (
    <ResizablePanelGroup
      orientation="vertical"
      defaultLayout={layout}
      onLayoutChanged={(next, meta) => {
        if (meta.isUserInteraction) setLayout(next)
      }}
    >
      {/* Sizes are strings so they are read as percentages; a bare
          number would be interpreted as pixels. */}
      <ResizablePanel id="preview" defaultSize="60" minSize="28">
        <PreviewPane compact onClose={() => togglePanel("preview")} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="assistant" defaultSize="40" minSize="25">
        <AssistantPanel onClose={() => togglePanel("assistant")} />
      </ResizablePanel>
    </ResizablePanelGroup>
  ) : panels.preview ? (
    <PreviewPane onClose={() => togglePanel("preview")} />
  ) : (
    <AssistantPanel onClose={() => togglePanel("assistant")} />
  )

  return (
    <div ref={ref} className="relative flex h-full min-h-0">
      <SectionRail
        active={pane}
        onSelect={(key) => {
          if (versionsOpen) navigate({ search: {} })
          setPane(key)
        }}
        collapsed={veryTight}
        panels={panels}
        onTogglePanel={togglePanel}
        versionsOpen={versionsOpen}
        onToggleVersions={toggleVersions}
      />

      {centerOpen && rightOpen ? (
        <ResizablePanelGroup
          orientation="horizontal"
          groupRef={columnsRef}
          defaultLayout={columns}
          onLayoutChanged={(next, meta) => {
            if (meta.isUserInteraction) setColumns(next)
          }}
        >
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
      ) : centerOpen ? (
        <div className="flex min-w-[300px] flex-1 flex-col overflow-hidden bg-paper">
          {editor}
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
          {side}
        </div>
      )}
    </div>
  )
}
