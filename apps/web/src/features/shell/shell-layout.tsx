import {
  type ResizablePanel,
  type ResizablePanelGroup,
  useResizableGroupRef,
  useResizablePanelRef,
} from "@workspace/ui/components/resizable"
import {
  createContext,
  use,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import { z } from "zod"

import { useLocalStorage } from "@/lib/use-local-storage"

/** Stored preferences. Module-level so the storage hook sees one schema value. */
const Panels = z.object({ preview: z.boolean(), assistant: z.boolean() })
const Split = z.record(z.string(), z.number()).optional()

export type PanelKey = "preview" | "assistant"

type GroupProps = ComponentProps<typeof ResizablePanelGroup>
type SplitProps = Pick<
  GroupProps,
  "groupRef" | "defaultLayout" | "onLayoutChanged"
>
type PanelProps = ComponentProps<typeof ResizablePanel>

/** The width the resume rail opens at, and what a drag may take it to. */
export const RAIL_WIDTH = 224
export const RAIL_MIN_WIDTH = 180
export const RAIL_MAX_WIDTH = 380

/** The shape of the shell every screen sits in. */
export type ShellLayout = {
  panels: z.infer<typeof Panels>
  togglePanel: (panel: PanelKey) => void
  railCollapsed: boolean
  toggleRail: () => void
}

const ShellLayoutContext = createContext<ShellLayout | null>(null)

export function ShellLayoutProvider({
  layout,
  children,
}: {
  layout: ShellLayout
  children: ReactNode
}) {
  return <ShellLayoutContext value={layout}>{children}</ShellLayoutContext>
}

export function useShellLayout(): ShellLayout {
  const layout = use(ShellLayoutContext)
  if (!layout)
    throw new Error("useShellLayout must be used inside a ShellLayoutProvider")
  return layout
}

/**
 * The state behind the shell: the resume rail's width and whether it is
 * collapsed, and the two side panels the bottom bar switches.
 *
 * The rail is a real panel rather than a fixed column, so the toggle asks the
 * panel to collapse instead of flipping a boolean; `railCollapsed` mirrors it
 * back for the button's state, including a drag that collapses the rail by
 * hand.
 */
export function useShellLayoutState() {
  const [panels, setPanels] = useLocalStorage("resume-studio.panels", Panels, {
    preview: true,
    assistant: false,
  })
  const [split, setSplit] = useLocalStorage(
    "resume-studio.shell-split",
    Split,
    undefined
  )
  const [railCollapsed, setRailCollapsed] = useState(false)
  const groupRef = useResizableGroupRef()
  const railRef = useResizablePanelRef()

  // Storage is read after mount, so a saved split lands after the group has
  // already taken its defaults. Push it in instead of remounting the panels.
  useEffect(() => {
    if (!split) return
    groupRef.current?.setLayout(split)
    setRailCollapsed((split.rail ?? 100) < 1)
  }, [split, groupRef])

  const togglePanel = (panel: PanelKey) =>
    setPanels((current) => ({ ...current, [panel]: !current[panel] }))

  const toggleRail = () => {
    const rail = railRef.current
    if (!rail) return
    if (rail.isCollapsed()) rail.expand()
    else rail.collapse()
  }

  const group: SplitProps = {
    groupRef,
    defaultLayout: split,
    onLayoutChanged: (next, meta) => {
      if (meta.isUserInteraction) setSplit(next)
    },
  }

  const onRailResize: NonNullable<PanelProps["onResize"]> = (size) =>
    setRailCollapsed(size.inPixels < 1)

  return {
    /** Handed to the provider so the bottom bar and the editor share it. */
    layout: {
      panels,
      togglePanel,
      railCollapsed,
      toggleRail,
    } satisfies ShellLayout,
    /** Spread onto the shell's panel group and the rail's panel. */
    group,
    railRef,
    onRailResize,
  }
}
