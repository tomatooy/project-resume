import { normalizeText } from "@workspace/autofill/match"
import { clip } from "../dom"
import type { PageInfo } from "../types"

/** The page info limits the service worker accepts. */
export const TITLE_MAX = 300
const COMPANY_MAX = 200

/** A board slug as a name: "office-hours" reads "Office Hours". */
export function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter((word) => word !== "")
    .map((word) => {
      const [first = "", ...rest] = word
      return first.toUpperCase() + rest.join("")
    })
    .join(" ")
}

/** The page's `og:site_name`, unless it names the vendor, not the company. */
export function siteName(doc: Document, vendorName: string): string | null {
  const content =
    doc
      .querySelector('meta[property="og:site_name"]')
      ?.getAttribute("content")
      ?.trim() ?? ""
  if (content === "" || normalizeText(content) === normalizeText(vendorName))
    return null
  return content
}

/**
 * The company named in the document title. A pattern counts only when its
 * `title` group is the job the page shows, so a stale title is ignored.
 */
export function titleCompany(
  doc: Document,
  title: string | null,
  patterns: readonly RegExp[]
): string | null {
  const wanted = title === null ? "" : normalizeText(title)
  if (wanted === "") return null
  const text = doc.title.trim()
  for (const pattern of patterns) {
    const groups = pattern.exec(text)?.groups
    if (!groups || normalizeText(groups.title ?? "") !== wanted) continue
    const company = groups.company?.trim() ?? ""
    if (company !== "") return company
  }
  return null
}

/**
 * The company comes from the page when it names one; the board or org slug
 * is a weak guess, shown but not used to match the job (spec 6.3).
 */
export function pageInfo(
  company: string | null,
  slug: string | undefined,
  title: string | null
): PageInfo {
  if (company)
    return { company: clip(company, COMPANY_MAX), companyWeak: false, title }
  const guess = slug ? clip(humanizeSlug(slug), COMPANY_MAX) : ""
  return { company: guess || null, companyWeak: guess !== "", title }
}
