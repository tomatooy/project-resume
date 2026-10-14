import { z } from "zod"
import { api, apiForAccount } from "../lib/api"
import { PdfRenderReplySchema, pdfBytes, type ResumePdf } from "./pdf-contract"

let queue: Promise<void> = Promise.resolve()

/**
 * Rendered bytes, kept by the identity that covers the document and every
 * choice that changes its appearance. A different template, option, locale or
 * font asset produces a different identity, so a hit cannot be a stale file.
 *
 * Keyed with the account as well: two accounts can hold byte-identical
 * sources, and bytes rendered for one are not handed to the other.
 */
const CACHE_LIMIT = 4
const cache = new Map<string, ResumePdf>()

function cacheKey(accountId: string | undefined, pdfId: string): string {
  return `${accountId ?? "session"}:${pdfId}`
}

function cached(key: string): ResumePdf | null {
  const found = cache.get(key)
  if (!found) return null
  // Re-inserted so the least recently used entry is the one evicted.
  cache.delete(key)
  cache.set(key, found)
  return found
}

function remember(key: string, file: ResumePdf): void {
  cache.delete(key)
  cache.set(key, file)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("PDF rendering cancelled"))
    signal.addEventListener("abort", abort, { once: true })
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort))
    if (signal.aborted) abort()
  })
}
export function prepareResumePdf(
  resumeId: string,
  bundleId: string,
  signal: AbortSignal,
  accountId?: string
): Promise<ResumePdf> {
  const job = queue.then(async () => {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)])
    deadline.throwIfAborted()
    const client = accountId ? await apiForAccount(accountId) : api
    const source = await client.autofill.document(
      { resumeId, bundleId },
      { signal: deadline }
    )
    if (source.bundleId !== bundleId) throw new Error("Source changed")
    // The pinned document is what was rendered and checked before, so its
    // bytes are reused instead of rendering the same file again. Only bytes
    // that passed `pdfBytes` are ever stored, so a hit is a validated file.
    const key = cacheKey(accountId, source.pdfId)
    const hit = cached(key)
    if (hit) return hit
    const url = chrome.runtime.getURL("offscreen.html")
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [url],
    })
    // A prior worker's unfinished render must not outlive its request.
    if (contexts.length) await chrome.offscreen.closeDocument()
    await chrome.offscreen.createDocument({
      url,
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: "Generate the selected resume PDF for application upload.",
    })
    try {
      for (;;) {
        deadline.throwIfAborted()
        const ready = await withSignal(
          chrome.runtime
            .sendMessage({ type: "af.pdf.ready", protocolVersion: 1 })
            .catch(() => null),
          deadline
        )
        if (z.object({ ready: z.literal(true) }).safeParse(ready).success) break
        await withSignal(
          new Promise<void>((resolve) => setTimeout(resolve, 100)),
          deadline
        )
      }
      const requestId = crypto.randomUUID()
      const reply = PdfRenderReplySchema.parse(
        await withSignal(
          chrome.runtime.sendMessage({
            type: "af.pdf.render",
            protocolVersion: 1,
            requestId,
            source,
          }),
          deadline
        )
      )
      if (
        !reply.ok ||
        reply.requestId !== requestId ||
        reply.file.pdfId !== source.pdfId
      )
        throw new Error("PDF unavailable")
      await pdfBytes(reply.file)
      deadline.throwIfAborted()
      remember(key, reply.file)
      return reply.file
    } finally {
      await chrome.offscreen.closeDocument().catch(() => undefined)
    }
  })
  queue = job.then(
    () => undefined,
    () => undefined
  )
  return withSignal(job, signal)
}
