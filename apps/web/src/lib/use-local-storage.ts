import { useCallback, useEffect, useState } from "react"
import type { z } from "zod"

/**
 * A preference that survives reloads but never reaches the server. Reads are
 * deferred to an effect so the server and client render the same first frame.
 *
 * What comes back from storage is whatever an older build wrote, so it is
 * parsed against the schema and the fallback wins on a mismatch.
 */
export function useLocalStorage<S extends z.ZodType>(
  key: string,
  schema: S,
  fallback: z.output<S>
) {
  type T = z.output<S>
  const [value, setValue] = useState<T>(fallback)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return
      const parsed = schema.safeParse(JSON.parse(raw))
      if (parsed.success) setValue(parsed.data)
    } catch {
      // Unreadable or private mode: keep the fallback.
    }
  }, [key, schema])

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      // Stored values are never functions, so a function here is an updater.
      const updater = next instanceof Function ? next : () => next
      setValue((current) => {
        const resolved = updater(current)
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
