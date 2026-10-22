const UNITS: [limitSeconds: number, seconds: number, name: string][] = [
  [60, 1, "second"],
  [3600, 60, "minute"],
  [86_400, 3600, "hour"],
  [604_800, 86_400, "day"],
  [2_629_800, 604_800, "week"],
  [31_557_600, 2_629_800, "month"],
  [Number.POSITIVE_INFINITY, 31_557_600, "year"],
]

/** "Edited 2h ago" style text, e.g. `Edited yesterday`, `Edited 3 weeks ago`. */
export function relativeTime(iso: string, now = Date.now()): string {
  const elapsed = (now - new Date(iso).getTime()) / 1000
  if (elapsed < 45) return "just now"

  for (const [limit, seconds, name] of UNITS) {
    if (elapsed >= limit) continue
    const value = Math.round(elapsed / seconds)
    if (name === "day" && value === 1) return "yesterday"
    return `${value} ${name}${value === 1 ? "" : "s"} ago`
  }
  return "a long time ago"
}

/** The wall-clock moment a timestamp names, for a title tooltip. */
export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function pluralize(
  count: number,
  one: string,
  many = `${one}s`
): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Stable keys for fixed-length skeleton placeholder lists. */
export const SKELETON_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const
