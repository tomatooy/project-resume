import { JobPostingSchema } from "@workspace/api/contract"
import {
  canonicalJobUrl,
  MAX_JOB_CHARS,
  MIN_JOB_CHARS,
  type JobIdentity,
} from "@workspace/resume-core/contracts"
import type { z } from "zod"

type JobPosting = z.infer<typeof JobPostingSchema>

/** Self-contained because Chrome serializes the injected function. */
function readPostingInTab(
  sourceUrl: string,
  postingUrl: string,
  jobId: string,
  minChars: number,
  maxChars: number
): JobPosting | null {
  if (location.href !== sourceUrl) return null
  const clean = (text: string): string =>
    text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
  for (const selector of [
    `#JobDetails_AboutTheJob_${jobId} [data-testid="expandable-text-box"]`,
    `#JobDetails_AboutTheJob_${jobId}`,
    "#job-details",
    ".jobs-description-content__text",
    ".jobs-description__content",
    ".description__text .show-more-less-html__markup",
    ".description__text",
  ]) {
    for (const description of document.querySelectorAll(selector)) {
      const displayedJobId = description
        .closest("[data-job-id]")
        ?.getAttribute("data-job-id")
      if (
        (displayedJobId && displayedJobId !== jobId) ||
        description.closest('[hidden], [inert], [aria-hidden="true"]') ||
        description.getClientRects().length === 0 ||
        getComputedStyle(description).visibility !== "visible"
      )
        continue
      const page =
        description.closest(
          '.jobs-search__job-details--container, .jobs-details, .job-view-layout, [data-testid="lazy-column"], main'
        ) ?? document
      const title =
        page.querySelector(
          ".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, .top-card-layout__title"
        ) ??
        page.querySelector(
          `a[href^="${postingUrl}"], a[href^="/jobs/view/${jobId}/"]`
        )
      const titleLink =
        title instanceof HTMLAnchorElement ? title : title?.querySelector("a")
      const linkedJobId = /\/jobs\/view\/(?:[^/?#]+-)?(\d{6,})(?:[/?#]|$)/.exec(
        titleLink?.getAttribute("href") ?? ""
      )?.[1]
      // A selected URL can change before LinkedIn replaces the old details.
      if (linkedJobId && linkedJobId !== jobId) continue
      const copy = description.cloneNode(true)
      if (!(copy instanceof Element)) continue
      for (const element of copy.querySelectorAll(
        'script, style, noscript, svg, button, [hidden], [aria-hidden="true"]'
      ))
        element.remove()
      for (const element of copy.querySelectorAll(
        "p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, section, br"
      ))
        element.append("\n")
      const body = clean(copy.textContent ?? "")
      if (body.length < minChars) continue
      let header = title?.parentElement
      while (
        header &&
        header !== page &&
        !header.querySelector('a[href*="/company/"]')
      )
        header = header.parentElement
      const heading = [
        title?.textContent ?? "",
        page.querySelector(
          ".job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, .topcard__org-name-link"
        )?.textContent ??
          header?.querySelector('a[href*="/company/"]')?.textContent ??
          "",
        page.querySelector(
          ".job-details-jobs-unified-top-card__primary-description-container, .jobs-unified-top-card__bullet, .topcard__flavor--bullet"
        )?.textContent ??
          header?.querySelector(":scope > p")?.textContent ??
          "",
      ]
        .map(clean)
        .filter(Boolean)
      if (location.href !== sourceUrl) return null
      return {
        url: postingUrl,
        text: [...heading, body].join("\n").slice(0, maxChars),
      }
    }
  }
  return null
}

export async function jobPosting(
  tabId: number,
  sourceUrl: string,
  identity: JobIdentity
): Promise<JobPosting | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: readPostingInTab,
      args: [
        sourceUrl,
        canonicalJobUrl(identity),
        identity.externalJobId,
        MIN_JOB_CHARS,
        MAX_JOB_CHARS,
      ],
    })
    const posting = JobPostingSchema.safeParse(result?.result)
    return posting.success ? posting.data : null
  } catch {
    return null
  }
}
