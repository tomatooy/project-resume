import type { JobIdentity } from "./job-identity"

export type LinkedInPage =
  | { kind: "unsupported" }
  | { kind: "select-job" }
  | { kind: "job"; identity: JobIdentity; sourceUrl: string }

export function linkedinExtensionPage(input: string): LinkedInPage {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { kind: "unsupported" }
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.linkedin.com" ||
    url.port ||
    url.username ||
    url.password
  )
    return { kind: "unsupported" }
  const ids = url.searchParams.getAll("currentJobId")
  if (ids.length > 1) return { kind: "unsupported" }
  const queryId = ids[0]
  let id: string | undefined
  if (url.pathname === "/jobs/search-results/" && url.search.length > 1) {
    if (!queryId || !/^\d{6,}$/.test(queryId)) return { kind: "select-job" }
    id = queryId
  } else {
    id = /^\/jobs\/view\/(?:[^/]+-)?(\d{6,})\/?$/.exec(url.pathname)?.[1]
    if (!id || (queryId !== undefined && queryId !== id))
      return { kind: "unsupported" }
  }
  return {
    kind: "job",
    identity: { platform: "linkedin", externalJobId: id },
    sourceUrl: url.href,
  }
}
export function matchesJobUrl(identity: JobIdentity, url: string): boolean {
  const page = linkedinExtensionPage(url)
  return (
    page.kind === "job" &&
    page.identity.externalJobId === identity.externalJobId
  )
}
