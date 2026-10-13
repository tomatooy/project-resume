import { z } from "zod"
import { PdfRenderRequestSchema } from "./pdf-contract"

let rendering = false
chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab ||
    (sender.url !== undefined &&
      sender.url !== chrome.runtime.getURL("background.js"))
  )
    return false
  if (
    z
      .strictObject({
        type: z.literal("af.pdf.ready"),
        protocolVersion: z.literal(1),
      })
      .safeParse(raw).success
  ) {
    respond({ ready: true })
    return false
  }
  const parsed = PdfRenderRequestSchema.safeParse(raw)
  if (!parsed.success) return false
  const { requestId, source } = parsed.data
  if (rendering) {
    respond({ ok: false, requestId })
    return false
  }
  rendering = true
  void import("./render-pdf")
    .then(({ renderResumePdf }) => renderResumePdf(source))
    .then(
      (file) => respond({ ok: true, requestId, file }),
      () => respond({ ok: false, requestId })
    )
    .finally(() => {
      rendering = false
    })
  return true
})
