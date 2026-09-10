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
    return htmlToText(await response.text())
  }
}

/**
 * One line per block of the page.
 *
 * The nesting is the problem: LinkedIn wraps every line box in its own div and
 * ships the markup pretty-printed, so most of the file is indentation and blank
 * space between tags. Those lines come out whitespace-only rather than empty,
 * which is why collapsing bare newline runs leaves them: each one still costs a
 * line in the textarea and a token in the prompt. Trimming every line and
 * dropping the empty ones leaves what the page was showing.
 */
export function htmlToText(html: string): string {
  return html
    .replace(DROP, " ")
    .replace(BLOCK, "\n")
    .replace(TAG, " ")
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITY[entity.toLowerCase()] ?? " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n")
}
