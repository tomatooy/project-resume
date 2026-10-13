// Entry points only; form compatibility is established by the control adapters.
export const AUTOFILL_APPLICATION_MATCHES = [
  "https://boards.greenhouse.io/*",
  "https://job-boards.greenhouse.io/*",
  "https://boards.eu.greenhouse.io/*",
  "https://job-boards.eu.greenhouse.io/*",
  "https://jobs.lever.co/*",
  "https://jobs.eu.lever.co/*",
  "https://jobs.ashbyhq.com/*",
  "https://*.myworkdayjobs.com/*",
  "https://*.icims.com/*",
  "https://jobs.smartrecruiters.com/*",
  "https://careers.smartrecruiters.com/*",
  "https://apply.workable.com/*",
  "https://jobs.jobvite.com/*",
] as const

export function isAutofillApplicationUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return false
    const host = url.hostname
    if (host === "icims.com" || host.endsWith(".icims.com"))
      return /^(?:careers|jobs)(?:-[a-z0-9-]+)?\.icims\.com$/.test(host)
    return AUTOFILL_APPLICATION_MATCHES.some((pattern) => {
      const domain = pattern.slice("https://".length, -2)
      return domain.startsWith("*.")
        ? host.endsWith(domain.slice(1))
        : host === domain
    })
  } catch {
    return false
  }
}
