import { useCallback, useState } from "react"

/**
 * Measures an element with a ResizeObserver. The editor's breakpoints are based
 * on the width of the content row, not the window, so the layout still adapts
 * when the resume rail is present.
 */
export function useElementWidth(initial = 1200) {
  const [width, setWidth] = useState(initial)

  const ref = useCallback((node: HTMLElement | null) => {
    if (!node || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0)
      if (next > 0) setWidth(next)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return { ref, width }
}
