import { z } from "zod"
import type {
  SourceStamp,
  SourceSnapshot,
} from "@workspace/resume-core/contracts"
import { api, apiForAccount } from "../lib/api"
import { PdfRenderReplySchema, pdfBytes, type ResumePdf } from "./pdf-contract"

let queue: Promise<void> = Promise.resolve()
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
  sourceStamp: SourceStamp,
  signal: AbortSignal,
  sourceSnapshot?: SourceSnapshot,
  accountId?: string
): Promise<ResumePdf> {
  const job = queue.then(async () => {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(30000)])
    deadline.throwIfAborted()
    const client = accountId ? await apiForAccount(accountId) : api
    const source = await client.autofill.document(
      { sourceStamp, ...(sourceSnapshot ? { sourceSnapshot } : {}) },
      { signal: deadline }
    )
    if (JSON.stringify(source.sourceStamp) !== JSON.stringify(sourceStamp))
      throw new Error("Source changed")
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
        JSON.stringify(reply.file.sourceStamp) !== JSON.stringify(sourceStamp)
      )
        throw new Error("PDF unavailable")
      await pdfBytes(reply.file)
      deadline.throwIfAborted()
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
