import { useEffect, useEffectEvent } from "react"

import type { AutoSaver } from "@/features/resume/auto-saver"

/**
 * Runs an autosaver while its page is open. It is armed on mount and again on
 * a remount, warns before the tab closes on an unsaved edit, and writes a
 * pending edit on unmount.
 */
export function useSaverLifecycle(
  saver: AutoSaver,
  isDirty: () => boolean
): void {
  const dirty = useEffectEvent(isDirty)
  useEffect(() => {
    saver.activate()
    const warnOnLeave = (event: BeforeUnloadEvent) => {
      if (dirty()) event.preventDefault()
    }
    window.addEventListener("beforeunload", warnOnLeave)
    return () => {
      window.removeEventListener("beforeunload", warnOnLeave)
      void saver.flush()
      saver.dispose()
    }
  }, [saver])
}
