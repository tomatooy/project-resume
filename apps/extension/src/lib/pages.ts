import { z } from "zod"
import {
  linkedinExtensionPage,
  type LinkedInPage,
} from "@workspace/resume-core/contracts"

export const AtsVendorSchema = z.enum([
  "workday",
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "icims",
])
export type AtsVendor = z.infer<typeof AtsVendorSchema>

// "*." hosts need a subdomain. Every host here is matched on the whole site.
const ATS: Record<
  AtsVendor,
  { name: string; hosts: string[]; exclude?: string[] }
> = {
  workday: {
    name: "Workday",
    hosts: ["*.myworkdayjobs.com", "*.myworkdaysite.com"],
  },
  greenhouse: {
    name: "Greenhouse",
    hosts: [
      "boards.greenhouse.io",
      "job-boards.greenhouse.io",
      "boards.eu.greenhouse.io",
      "job-boards.eu.greenhouse.io",
    ],
  },
  lever: { name: "Lever", hosts: ["jobs.lever.co", "jobs.eu.lever.co"] },
  ashby: { name: "Ashby", hosts: ["jobs.ashbyhq.com"] },
  smartrecruiters: {
    name: "SmartRecruiters",
    hosts: ["jobs.smartrecruiters.com", "careers.smartrecruiters.com"],
  },
  icims: { name: "iCIMS", hosts: ["*.icims.com"], exclude: ["www.icims.com"] },
}

export function atsName(vendor: AtsVendor): string {
  return ATS[vendor].name
}

export const LINKEDIN_MATCH = "https://www.linkedin.com/*"
/** Content script and host permission patterns, in manifest order. */
export const SUPPORTED_MATCHES = [
  LINKEDIN_MATCH,
  ...AtsVendorSchema.options.flatMap((vendor) =>
    ATS[vendor].hosts.map((host) => `https://${host}/*`)
  ),
]

export type Page = LinkedInPage | { kind: "ats"; vendor: AtsVendor }
export type Category = "job" | "ats" | "unsupported"

export function atsVendor(input: string): AtsVendor | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password)
    return null
  const host = url.hostname
  return (
    AtsVendorSchema.options.find(
      (vendor) =>
        !ATS[vendor].exclude?.includes(host) &&
        ATS[vendor].hosts.some((pattern) =>
          pattern.startsWith("*.")
            ? host.endsWith(pattern.slice(1))
            : host === pattern
        )
    ) ?? null
  )
}

export function classifyPage(input: string): Page {
  const linkedin = linkedinExtensionPage(input)
  if (linkedin.kind !== "unsupported") return linkedin
  const vendor = atsVendor(input)
  return vendor ? { kind: "ats", vendor } : linkedin
}

export function categoryOf(page: Page): Category {
  return page.kind === "job" || page.kind === "select-job" ? "job" : page.kind
}
