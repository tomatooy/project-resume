const identifier = /^[a-z0-9_-]{2,128}$/i
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const queryNames = new Set([
  "applicationid",
  "application_id",
  "jobid",
  "job_id",
  "gh_jid",
  "requisitionid",
  "requisition_id",
  "reqid",
])

/**
 * The identity of one application, taken from the page's own evidence: host,
 * path and a named query parameter. Tracking parameters are ignored by
 * construction, and an unknown identity is null rather than a guess from the
 * hostname, so two applications on one host never share temporary answers.
 */
export function applicationIdentity(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.username || url.password) return null
  const keys = new Map<string, string>()
  for (const [name, value] of url.searchParams) {
    const key = name.toLowerCase()
    if (!queryNames.has(key)) continue
    if (!identifier.test(value) || (keys.has(key) && keys.get(key) !== value))
      return null
    keys.set(key, value)
  }
  const path = url.pathname
    .replace(/\/(?:apply|application)(?:\/.*)?\/?$/i, "")
    .replace(/\/$/, "")
  if (keys.size) {
    const ordered = [...keys].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `${url.origin}${path}?${new URLSearchParams(ordered)}`
  }
  const parts = path.split("/").filter(Boolean)
  const last = parts.at(-1)
  if (!last) return null
  const job = parts.findIndex((part) =>
    /^(?:job|jobs|requisition)$/i.test(part)
  )
  if (
    uuid.test(last) ||
    (job >= 0 && job < parts.length - 1 && /\d/.test(last))
  )
    return `${url.origin}${path}`
  return null
}

export function sameApplication(
  previous: string | null | undefined,
  current: string | null | undefined
): boolean {
  return Boolean(previous && current && previous === current)
}

/** Origin of a browser-reported URL; empty when the URL is unusable. */
export function originOf(raw: string): string {
  try {
    return new URL(raw).origin
  } catch {
    return ""
  }
}
