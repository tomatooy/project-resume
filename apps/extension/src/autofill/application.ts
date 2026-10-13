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
    const ordered = [...keys].sort(([a], [b]) => a.localeCompare(b))
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
