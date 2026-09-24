import { useLayoutEffect, useRef } from "react"
import { useOptionalWorkspace } from "./context"

export function useTabScroll(key: string, initialBottom = false) {
  const workspace = useOptionalWorkspace()
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || !workspace) return
    element.scrollTop =
      workspace.scroll.get(key) ?? (initialBottom ? element.scrollHeight : 0)
    const remember = () => workspace.scroll.set(key, element.scrollTop)
    element.addEventListener("scroll", remember, { passive: true })
    return () => {
      element.removeEventListener("scroll", remember)
    }
  }, [key, workspace, initialBottom])
  return ref
}
