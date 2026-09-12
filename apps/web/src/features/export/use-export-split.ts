import {
  type ResizablePanelGroup,
  useResizableGroupRef,
} from "@workspace/ui/components/resizable"
import { type ComponentProps, useEffect } from "react"
import { z } from "zod"

import { useLocalStorage } from "@/lib/use-local-storage"

/** Stored preference. Module-level so the storage hook sees one schema value. */
const Split = z.record(z.string(), z.number()).optional()

type GroupProps = ComponentProps<typeof ResizablePanelGroup>
type SplitProps = Pick<
  GroupProps,
  "groupRef" | "defaultLayout" | "onLayoutChanged"
>

/** Where the user dragged the line between the export column and the preview. */
export function useExportSplit(): SplitProps {
  const [split, setSplit] = useLocalStorage(
    "resume-studio.export-split",
    Split,
    undefined
  )
  const groupRef = useResizableGroupRef()

  // Storage is read after mount, so a saved split lands after the group has
  // already taken its defaults. Push it in instead of remounting the panes.
  useEffect(() => {
    if (split) groupRef.current?.setLayout(split)
  }, [split, groupRef])

  return {
    groupRef,
    defaultLayout: split,
    onLayoutChanged: (next, meta) => {
      if (meta.isUserInteraction) setSplit(next)
    },
  }
}
