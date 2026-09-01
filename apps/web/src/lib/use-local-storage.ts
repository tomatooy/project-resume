import { useCallback, useEffect, useState } from "react"

/**
 * A preference that survives reloads but never reaches the server. Reads are
 * deferred to an effect so the server and client render the same first frame.
 */
export function useLocalStorage<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) setValue(JSON.parse(raw) as T)
    } catch {
      // Unreadable or private mode: keep the fallback.
    }
  }, [key])

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved =
          typeof next === "function" ? (next as (c: T) => T)(current) : next
        try {
          localStorage.setItem(key, JSON.stringify(resolved))
        } catch {
          // Quota or private mode: the value still applies for this session.
        }
        return resolved
      })
    },
    [key]
  )

  return [value, update] as const
}
