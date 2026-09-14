import {
  type ResizablePanelGroup,
  useResizableGroupRef,
} from "@workspace/ui/components/resizable"
import { type ComponentProps, useEffect, useState } from "react"
import { z } from "zod"

import type { ResumeTab } from "@/features/shell/resume-tabs"
import { type PanelKey, useShellLayout } from "@/features/shell/shell-layout"
import { useElementWidth } from "@/lib/use-element-width"
import { useLocalStorage } from "@/lib/use-local-storage"

/** Stored preference. Module-level so the storage hook sees one schema value. */
const Split = z.record(z.string(), z.number()).optional()

/** Below this the middle column yields to the side panels. */
const VERY_TIGHT = 980

type GroupProps = ComponentProps<typeof ResizablePanelGroup>
type SplitProps = Pick<
  GroupProps,
  "groupRef" | "defaultLayout" | "onLayoutChanged"
>

/**
 * Storage is read after mount, so a saved split lands after its group has
 * already taken the defaults. Push it in instead of remounting the panes.
 */
function useRestoredSplit(
  split: Record<string, number> | undefined,
  group: ReturnType<typeof useResizableGroupRef>
) {
  useEffect(() => {
    if (split) group.current?.setLayout(split)
  }, [split, group])
}

/**
 * Everything the four tabs remember about the shape they share: where the user
 * dragged the splits. A maximized pane does not persist across reloads: that
 * hides everything else, and a reload should not reopen a screen the user
 * cannot edit. The side panels come from the shell, since the bottom bar
 * switches them too.
 */
export function useWorkspaceLayout({ tab }: { tab: ResumeTab }) {
  const { panels, togglePanel } = useShellLayout()
  const { ref, width } = useElementWidth()

  const [maximized, setMaximized] = useState<PanelKey | null>(null)
  // The middle column's own maximize, from the tab strip: the side panes stand
  // down but stay switched on, and it is not persisted, for the same reasons a
  // maximized pane is not.
  const [fullWidth, setFullWidth] = useState(false)
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
  const sideRef = useResizableGroupRef()
  useRestoredSplit(columnSplit, columnsRef)
  useRestoredSplit(sideSplit, sideRef)

  // Two panes and no room for both: Editor's column is the one that yields,
  // because it is also the only tab that can be edited somewhere else (the
  // preview). The other three keep their column at any width, so Export's
  // download does not vanish on a narrow window.
  const collapsed = width < VERY_TIGHT
  const rightOpen = panels.preview || panels.assistant
  const centerOpen = tab.id !== "editor" || !(collapsed && rightOpen)

  // Maximizing is a look, not a close: the other pane stays switched on and
  // comes back when this one is restored.
  const toggleMaximize = (panel: PanelKey) =>
    setMaximized((current) => (current === panel ? null : panel))
  const toggleFullWidth = () => setFullWidth((current) => !current)

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
    groupRef: sideRef,
    defaultLayout: sideSplit,
    onLayoutChanged: (next, meta) => {
      if (meta.isUserInteraction) setSideSplit(next)
    },
  }

  return {
    /** Goes on the element whose width sets the breakpoints. */
    ref,
    panels,
    togglePanel,
    /** The pane filling everything but the resume rail, or null for the grid. */
    maximized,
    toggleMaximize,
    /** The middle column taking the whole row, side panes hidden not closed. */
    fullWidth,
    toggleFullWidth,
    rightOpen,
    centerOpen,
    splitBoth: panels.preview && panels.assistant,
    /** Spread onto the middle/side and preview/assistant panel groups. */
    columns,
    side,
  }
}
