/**
 * LinkedIn shows one posting under several shapes: a slugged search result, a
 * collections page carrying the id in the query, an email `/comm/` link, and a
 * country subdomain. Only the canonical form fetches reliably, so everything is
 * reduced to it before it is stored or fetched.
 *
 * Returning null rather than throwing is deliberate: "this is not a LinkedIn
 * job posting" is an answer the dialog shows next to the field, not an error.
 */
const JOB_ID = /(?:^|[/-])(\d{6,})\/?$/
const HOST = /^(?:[a-z]{2}\.)?(?:www\.)?linkedin\.com$/

export function normalizeLinkedInJobUrl(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed === "") return null

  let url: URL
  try {
    url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    )
  } catch {
    return null
  }

  if (!HOST.test(url.hostname.toLowerCase())) return null

  // The collections and search pages put the id in the query, and the path
  // says nothing about which posting is open.
  const fromQuery = url.searchParams.get("currentJobId")
  if (fromQuery && /^\d{6,}$/.test(fromQuery)) return canonical(fromQuery)

  const path = url.pathname.replace(/^\/comm/, "")
  if (!path.startsWith("/jobs/view/")) return null

  const id = JOB_ID.exec(path)?.[1]
  return id ? canonical(id) : null
}

function canonical(id: string): string {
  return `https://www.linkedin.com/jobs/view/${id}/`
}
