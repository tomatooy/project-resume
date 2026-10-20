import type { Fill } from "@workspace/autofill/fields"
import {
  type ContentMessage,
  ContentMessageSchema,
} from "../../lib/autofill-protocol"
import { autofillVendor, classifyPage } from "../../lib/pages"
import { draft, run, syncOverlay, writeFills } from "./controller"
import { registerOrigin, takeOrigin } from "./origin"
import { sendToContent } from "./send"
import {
  type AutofillSession,
  applyScan,
  fieldsToFill,
  markDrafted,
  markOwned,
  readDocument,
  type ScanFrame,
  type ScanMessage,
  updateSession,
} from "./session"

/**
 * The sender's tab and frame when it is our content script in the top frame
 * of an autofill page (spec 15.3). Anything else is not listened to.
 */
function contentFrame(
  sender: chrome.runtime.MessageSender
): { tabId: number; frame: ScanFrame } | null {
  const tabId = sender.tab?.id
  const vendor = autofillVendor(classifyPage(sender.url ?? ""))
  if (
    sender.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    tabId === undefined ||
    vendor === null ||
    sender.documentId === undefined
  )
    return null
  return { tabId, frame: { documentId: sender.documentId, frameId: 0, vendor } }
}

/** Puts back what we wrote before the page reloaded. */
async function restoreFills(
  tabId: number,
  session: AutofillSession,
  restore: Fill[]
): Promise<void> {
  await writeFills(
    tabId,
    session,
    fieldsToFill(
      session,
      restore.filter(({ kind }) => kind !== "resume-file")
    )
  )
  if (!restore.some(({ kind }) => kind === "resume-file")) return
  const document = await readDocument(tabId)
  if (!document) return
  const at = Date.now()
  await updateSession(tabId, (current) =>
    current?.postingKey === session.postingKey
      ? {
          ...current,
          attach: {
            versionId: document.versionId,
            status: "pending",
            at,
            previous: null,
          },
        }
      : current
  )
}

async function takeScan(
  tabId: number,
  frame: ScanFrame,
  scan: ScanMessage
): Promise<void> {
  const now = Date.now()
  const { before, after } = await updateSession(
    tabId,
    (session) => applyScan(session, scan, frame, now).session
  )
  if (!after) return
  // The reducer is pure, so the same inputs give its lists again.
  const { added, restore } = applyScan(before, scan, frame, now)
  const fresh = before === null || before.postingKey !== scan.postingKey
  if (fresh && scan.postingKey !== null) {
    const linkedin = await takeOrigin(tabId)
    if (linkedin)
      await updateSession(tabId, (current) =>
        current?.postingKey === scan.postingKey && current.linkedin === null
          ? { ...current, linkedin, planAt: null }
          : current
      )
  }
  if (restore.length > 0) await restoreFills(tabId, after, restore)
  // Another posting clears the Write with AI buttons; a reload brings them
  // back.
  if (before !== null && (fresh || before.documentId !== frame.documentId))
    await syncOverlay(tabId)
  // Fields that appear after the first run get an automatic pass.
  if (after.started !== null && added.length > 0) await run(tabId, "auto")
}

async function onContent(
  tabId: number,
  frame: ScanFrame,
  message: ContentMessage
): Promise<void> {
  switch (message.type) {
    case "autofill-scan":
      return takeScan(tabId, frame, message)
    case "autofill-owned":
      await updateSession(tabId, (session) =>
        session ? markOwned(session, message.fieldIds) : session
      )
      return
    case "autofill-draft":
      return draft(tabId, message.fieldId, message.instruction)
    case "autofill-inserted":
      await updateSession(tabId, (session) =>
        session ? markDrafted(session, message.fieldId) : session
      )
      return
  }
}

export function registerAutofill(): void {
  registerOrigin()
  chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
    const from = contentFrame(sender)
    if (!from) return false
    const parsed = ContentMessageSchema.safeParse(raw)
    if (!parsed.success) return false
    // The content script only learns that the message arrived.
    respond({ ok: true })
    void onContent(from.tabId, from.frame, parsed.data).catch(() => {})
    return false
  })
  // A single-page app moves to another posting without a new document.
  chrome.webNavigation.onHistoryStateUpdated.addListener(
    ({ frameId, tabId, url }) => {
      if (frameId !== 0 || autofillVendor(classifyPage(url)) === null) return
      void sendToContent(tabId, 0, { type: "autofill-rescan" }).catch(() => {})
    }
  )
}
