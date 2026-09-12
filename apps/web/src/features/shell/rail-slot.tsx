import { createContext, use, useMemo, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

/**
 * The seam between the rail and the document it lists. The shell draws the
 * resume rows above the route that owns the open resume, so the route cannot
 * reach the row it needs: the rail leaves a mount under the open row and the
 * route portals the sections into it. Portal children keep their React
 * context, so the sections still read the session they were mounted under.
 */
type RailSlot = {
  host: HTMLElement | null
  attach: (node: HTMLElement | null) => void
}

const RailSlotContext = createContext<RailSlot | null>(null)

export function RailSlotProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const value = useMemo(() => ({ host, attach: setHost }), [host])
  return <RailSlotContext value={value}>{children}</RailSlotContext>
}

/** Left in the open resume's row, which is the one that expands. */
export function RailSlotHost() {
  const { attach } = useRailSlot()
  return <div ref={attach} />
}

/** Rendered by a route: portals its content into that mount. */
export function RailSlotContent({ children }: { children: ReactNode }) {
  const { host } = useRailSlot()
  return host ? createPortal(children, host) : null
}

function useRailSlot(): RailSlot {
  const slot = use(RailSlotContext)
  if (!slot) {
    throw new Error("The rail slot must be used inside a RailSlotProvider")
  }
  return slot
}
