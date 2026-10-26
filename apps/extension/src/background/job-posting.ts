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
async function fetchPostingInTab(
  sourceUrl: string,
  postingUrl: string,
  minChars: number,
  maxChars: number
): Promise<JobPosting | null> {
  if (location.href !== sourceUrl) return null
  // Use the browser's network without sending the user's LinkedIn cookies.
  const response = await fetch(postingUrl, {
    credentials: "omit",
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) return null
  const html = await response.text()
  if (location.href !== sourceUrl) return null
  const page = new DOMParser().parseFromString(html, "text/html")
  const description = page.querySelector(
    ".description__text .show-more-less-html__markup, .description__text, #job-details"
  )
  if (!description) return null
  for (const element of description.querySelectorAll(
    "script, style, noscript, svg, button"
  ))
    element.remove()
  for (const element of description.querySelectorAll(
    "p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, section, br"
  ))
    element.append("\n")
  const clean = (text: string): string =>
    text
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
  const body = clean(description.textContent ?? "")
  if (body.length < minChars) return null
  const heading = [
    ".top-card-layout__title",
    ".topcard__org-name-link",
    ".topcard__flavor--bullet",
  ]
    .map((selector) => clean(page.querySelector(selector)?.textContent ?? ""))
    .filter(Boolean)
  return {
    url: response.url,
    text: [...heading, body].join("\n").slice(0, maxChars),
  }
}

export async function jobPosting(
  tabId: number,
  sourceUrl: string,
  identity: JobIdentity
): Promise<JobPosting | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: fetchPostingInTab,
      args: [
        sourceUrl,
        canonicalJobUrl(identity),
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
