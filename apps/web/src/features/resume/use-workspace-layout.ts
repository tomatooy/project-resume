import {
  type ResizablePanelGroup,
  useResizableGroupRef,
} from "@workspace/ui/components/resizable"
import { type ComponentProps, useEffect, useState } from "react"
import { z } from "zod"

import { type PanelKey, useShellLayout } from "@/features/shell/shell-layout"
import { useElementWidth } from "@/lib/use-element-width"
import { useLocalStorage } from "@/lib/use-local-storage"
import { useResumeWorkspace } from "../workspace"

/** Stored preference. Module-level so the storage hook sees one schema value. */
const Split = z.record(z.string(), z.number()).optional()

/** Below this the form yields to the side panels. */
const VERY_TIGHT = 980

type GroupProps = ComponentProps<typeof ResizablePanelGroup>
type SplitProps = Pick<
  GroupProps,
  "groupRef" | "defaultLayout" | "onLayoutChanged"
>

/**
 * Everything the editor screen remembers about its own shape: where the user
 * dragged the splits. A maximized pane does not persist across reloads: that
 * hides the form, and a reload should not reopen a screen the user cannot
 * edit. The open pane comes from the workspace, the side panels and Versions
 * from the shell, since the bottom bar switches them too.
 */
export function useEditorLayout({ versionsOpen }: { versionsOpen: boolean }) {
  const { pane, setPane } = useResumeWorkspace()
  const { panels, togglePanel } = useShellLayout()
  const { ref, width } = useElementWidth()

  const [maximized, setMaximized] = useState<PanelKey | null>(null)
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
  const collapsed = width < VERY_TIGHT
  const rightOpen = panels.preview || panels.assistant
  // The form yields to the side panels when there is no room for both, but
  // versions was asked for outright, so it always gets the column.
  const centerOpen = versionsOpen || !(collapsed && rightOpen)

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
    rightOpen,
    centerOpen,
    splitBoth: panels.preview && panels.assistant,
    /** Spread onto the editor/side and preview/assistant panel groups. */
    columns,
    side,
  }
}
