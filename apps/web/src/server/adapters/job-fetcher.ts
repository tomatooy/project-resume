import type { JobFetcher } from "@workspace/resume-core"

/**
 * Fetches a posting on the Worker and reduces it to text.
 *
 * There is no HTML parser here on purpose: the Worker has no DOM, a parser
 * would be a dependency for one call site, and a job posting is prose. Scripts
 * and styles go first so their contents do not survive as text, then tags
 * become nothing and block-level ones become newlines.
 */
const BLOCK = /<\/(?:p|div|li|ul|ol|h[1-6]|section|br)\s*>|<br\s*\/?>/gi
const DROP = /<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi
const TAG = /<[^>]+>/g
const ENTITY: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
}

/** A browser user agent, because the bare Worker one is refused outright. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

const TIMEOUT_MS = 10_000

export class WorkerJobFetcher implements JobFetcher {
  async fetch(url: string, signal?: AbortSignal): Promise<string> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS)
    const response = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!response.ok) return ""
    return toText(await response.text())
  }
}

function toText(html: string): string {
  return html
    .replace(DROP, " ")
    .replace(BLOCK, "\n")
    .replace(TAG, " ")
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITY[entity.toLowerCase()] ?? " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
