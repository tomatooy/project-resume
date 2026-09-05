import type { Clock, TimerHandle } from "./auto-saver"

/**
 * A clock the test drives by hand. Timing is the whole of what autosave
 * decides, so this is the seam that makes any of it observable.
 */
export function fakeClock() {
  let next = 1
  const pending = new Map<number, { fn: () => void; delay: number }>()

  const clock: Clock = {
    setTimeout: (fn, delay) => {
      const id = next++
      pending.set(id, { fn, delay })
      return id as unknown as TimerHandle
    },
    clearTimeout: (handle) => {
      pending.delete(handle as unknown as number)
    },
  }

  return {
    clock,
    get armed(): boolean {
      return pending.size > 0
    },
    /** The delay the currently armed timer was set with. */
    get delay(): number | undefined {
      return [...pending.values()][0]?.delay
    },
    /** Fires every armed timer, as the real clock eventually would. */
    tick(): void {
      const due = [...pending.entries()]
      pending.clear()
      for (const [, entry] of due) entry.fn()
    },
  }
}
