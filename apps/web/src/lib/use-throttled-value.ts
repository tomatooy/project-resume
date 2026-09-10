import { useEffect, useRef, useState } from "react"

/**
 * Follows a value that changes in bursts, at most once every `delayMs`.
 *
 * The leading edge keeps the first move immediate; the timer's tail commit is
 * what makes the last one land, so a burst that stops mid-interval still
 * settles on the value it ended at. A debounce is the wrong shape here: it
 * would sit still for the whole gesture and then jump.
 */
export function useThrottledValue<T>(value: T, delayMs: number): T {
  const [throttled, setThrottled] = useState(value)
  const latest = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    latest.current = value
    // A tail commit is already scheduled, and it reads `latest`.
    if (timer.current !== null || value === throttled) return
    setThrottled(value)
    timer.current = setTimeout(() => {
      timer.current = null
      setThrottled(latest.current)
    }, delayMs)
  }, [value, throttled, delayMs])

  // Strictly unmount: the effect above re-runs on every change, and clearing
  // there would drop the tail commit it just scheduled.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    []
  )

  return throttled
}
