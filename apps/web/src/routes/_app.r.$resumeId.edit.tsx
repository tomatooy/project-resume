import { createFileRoute } from "@tanstack/react-router"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { useEffect, useState } from "react"

import { AssistantPanel } from "@/features/chat/AssistantPanel"
import { ConflictBanner } from "@/features/resume/ConflictBanner"
import { EditorPane } from "@/features/resume/editor/EditorPane"
import { SectionRail, type PaneKey } from "@/features/resume/editor/SectionRail"
import { PreviewPane } from "@/features/resume/preview/PreviewPane"
import { useResumeState, useSession } from "@/features/resume/session-context"
import { useElementWidth } from "@/lib/use-element-width"
import { useLocalStorage } from "@/lib/use-local-storage"

export const Route = createFileRoute("/_app/r/$resumeId/edit")({
  component: EditorScreen,
})

/** Below this the section rail collapses to initials and the form yields. */
const VERY_TIGHT = 980

function EditorScreen() {
  const session = useSession()
  const doc = useResumeState((s) => s.doc)
  const { ref, width } = useElementWidth()

  const [pane, setPane] = useState<PaneKey>("contact")
  const [panels, setPanels] = useLocalStorage("resume-studio.panels", {
    preview: true,
    assistant: false,
  })
  const [layout, setLayout] = useLocalStorage<
    Record<string, number> | undefined
  >("resume-studio.right-split", undefined)

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
  const formOpen = !(veryTight && rightOpen)

  const togglePanel = (panel: "preview" | "assistant") =>
    setPanels((current) => ({ ...current, [panel]: !current[panel] }))

  return (
    <div ref={ref} className="relative flex h-full min-h-0">
      <SectionRail
        active={pane}
        onSelect={setPane}
        collapsed={veryTight}
        panels={panels}
        onTogglePanel={togglePanel}
      />

      {formOpen ? (
        <div className="min-w-[300px] flex-[1_1_420px] overflow-y-auto border-r border-border bg-paper px-6 pt-[22px] pb-[76px]">
          <ConflictBanner />
          <EditorPane pane={pane} />
        </div>
      ) : null}

      {rightOpen ? (
        <div
          className="flex min-w-0 flex-col overflow-hidden border-l border-border bg-canvas"
          style={{
            flex: `1 0 ${panels.preview ? 472 : 360}px`,
            maxWidth: panels.preview ? 640 : 420,
            // Reserved once here so neither pane needs its own dead space
            // under the floating mode pill.
            paddingBottom: splitBoth ? 66 : 0,
          }}
        >
          {splitBoth ? (
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
                <PreviewPane compact />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="assistant" defaultSize="40" minSize="25">
                <AssistantPanel onClose={() => togglePanel("assistant")} />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : panels.preview ? (
            <PreviewPane />
          ) : (
            <AssistantPanel onClose={() => togglePanel("assistant")} />
          )}
        </div>
      ) : null}
    </div>
  )
}
