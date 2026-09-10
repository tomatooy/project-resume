import {
  type ResizablePanelGroup,
  useResizableGroupRef,
} from "@workspace/ui/components/resizable"
import { type ComponentProps, useEffect, useState } from "react"
import { z } from "zod"

import { useElementWidth } from "@/lib/use-element-width"
import { useLocalStorage } from "@/lib/use-local-storage"
import { useResumeState } from "../session-context"
import type { PaneKey } from "./SectionRail"

/** Stored preferences. Module-level so the storage hook sees one schema value. */
const Panels = z.object({ preview: z.boolean(), assistant: z.boolean() })
const Split = z.record(z.string(), z.number()).optional()

/** Below this the section rail collapses to initials and the form yields. */
const VERY_TIGHT = 980

export type PanelKey = "preview" | "assistant"

type GroupProps = ComponentProps<typeof ResizablePanelGroup>
type SplitProps = Pick<
  GroupProps,
  "groupRef" | "defaultLayout" | "onLayoutChanged"
>

/**
 * Everything the editor screen remembers about its own shape: which section
 * is open, which side panels are up, and where the user dragged the splits.
 * The panels and splits persist across reloads; the open section does not,
 * and neither does a maximized pane: that hides the form, and a reload should
 * not reopen a screen the user cannot edit.
 *
 * Versions is the one column the caller decides, since it lives in the URL.
 */
export function useEditorLayout({ versionsOpen }: { versionsOpen: boolean }) {
  const sections = useResumeState((s) => s.doc.sections)
  const { ref, width } = useElementWidth()

  const [pane, setPane] = useState<PaneKey>("contact")
  const [maximized, setMaximized] = useState<PanelKey | null>(null)
  const [panels, setPanels] = useLocalStorage("resume-studio.panels", Panels, {
    preview: true,
    assistant: false,
  })
  const [sideSplit, setSideSplit] = useLocalStorage(
    "resume-studio.right-split",
    Split,
    undefined
  )
  const [columnSplit, setColumnSplit] = useLocalStorage(
    "resume-studio.column-split",
    Split,
    undefined
  )
  const columnsRef = useResizableGroupRef()

  // Storage is read after mount, so a saved split lands after the group has
  // already taken its defaults. Push it in instead of remounting the panes.
  useEffect(() => {
    if (columnSplit) columnsRef.current?.setLayout(columnSplit)
  }, [columnSplit, columnsRef])

  // A section deleted while it was open would leave the pane pointing nowhere.
  useEffect(() => {
    if (pane === "contact" || pane === "summary") return
    if (!sections.some((section) => section.id === pane)) setPane("contact")
  }, [sections, pane])

  const collapsed = width < VERY_TIGHT
  const rightOpen = panels.preview || panels.assistant
  // The form yields to the side panels when there is no room for both, but
  // versions was asked for outright, so it always gets the column.
  const centerOpen = versionsOpen || !(collapsed && rightOpen)

  const togglePanel = (panel: PanelKey) =>
    setPanels((current) => ({ ...current, [panel]: !current[panel] }))

  // Maximizing is a look, not a close: the other pane stays switched on and
  // comes back when this one is restored.
  const toggleMaximize = (panel: PanelKey) =>
    setMaximized((current) => (current === panel ? null : panel))

  // A maximized pane that gets switched off has nothing left to render, so the
  // layout follows it out.
  useEffect(() => {
    if (maximized && !panels[maximized]) setMaximized(null)
  }, [maximized, panels])

  const columns: SplitProps = {
    groupRef: columnsRef,
    defaultLayout: columnSplit,
    onLayoutChanged: (next, meta) => {
      if (meta.isUserInteraction) setColumnSplit(next)
    },
  }
  const side: SplitProps = {
    defaultLayout: sideSplit,
    onLayoutChanged: (next, meta) => {
      if (meta.isUserInteraction) setSideSplit(next)
    },
  }

  return {
    /** Goes on the element whose width sets the breakpoints. */
    ref,
    pane,
    setPane,
    panels,
    togglePanel,
    /** The pane filling everything but the resume rail, or null for the grid. */
    maximized,
    toggleMaximize,
    collapsed,
    rightOpen,
    centerOpen,
    splitBoth: panels.preview && panels.assistant,
    /** Spread onto the editor/side and preview/assistant panel groups. */
    columns,
    side,
  }
}
