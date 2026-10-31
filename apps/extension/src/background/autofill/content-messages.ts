import type { Fill } from "@workspace/autofill/fields"
import { z } from "zod"
import { trace } from "../../autofill/debug"
import { scanUrl } from "../../autofill/posting-url"
import {
  type ContentMessage,
  ContentMessageSchema,
} from "../../lib/autofill-protocol"
import { autofillVendor, classifyPage } from "../../lib/pages"
import { refreshHost } from "../widget"
import {
  autofillFrame,
  type AutofillFrame,
  frameVisible,
  sameDocument,
  updateDetectionBadge,
} from "./frames"
import { draft, run, syncOverlay, writeFills } from "./controller"
import { registerOrigin, takeOrigin } from "./origin"
import { sendToContent } from "./send"
import { resolveSearchRequest } from "./search-resolution"
import {
  type AutofillSession,
  applyScan,
  fieldsToFill,
  markDrafted,
  markOwned,
  readDocument,
  readSession,
  type ScanFrame,
  type ScanMessage,
  updateSession,
} from "./session"

/** Browser metadata, never an iframe URL claimed by a page message. */
async function contentFrame(
  sender: chrome.runtime.MessageSender
): Promise<{ tabId: number; frame: AutofillFrame } | null> {
  const tabId = sender.tab?.id
  if (
    sender.id !== chrome.runtime.id ||
    sender.frameId === undefined ||
    sender.frameId < 0 ||
    tabId === undefined ||
    sender.documentId === undefined
  )
    return null
  const frame = await autofillFrame(tabId)
  return frame &&
    frame.frameId === sender.frameId &&
    frame.documentId === sender.documentId
    ? { tabId, frame }
    : null
}

/** Puts back what we wrote before the page reloaded. */
async function restoreFills(
  tabId: number,
  session: AutofillSession,
  restore: Fill[]
): Promise<void> {
  await writeFills(tabId, session, fieldsToFill(session, restore))
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
  if (!after || after === before) return
  // The reducer is pure, so the same inputs give its lists again.
  const { added, restore } = applyScan(before, scan, frame, now)
  const labelOf = (id: string): string =>
    scan.fields.find((field) => field.id === id)?.label ?? id
  trace(
    `2. worker got the scan: ${scan.fields.length} fields, ${added.length} new${added.length > 0 ? " (new fields get an automatic pass once Autofill has run)" : ""}`,
    { new: added.map(labelOf), restored: restore.length }
  )
  const fresh = before === null || before.postingKey !== scan.postingKey
  if (fresh && scan.postingKey !== null) {
    const linkedin = await takeOrigin(tabId)
    trace(
      linkedin
        ? "this posting was opened from LinkedIn, so how-did-you-hear rules answer LinkedIn"
        : "this posting was not opened from LinkedIn, so how-did-you-hear goes to AI"
    )
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
  // Fields that appear get an automatic pass once a run has started the
  // record. One that appears during a pass gets it when that pass ends.
  if (added.length > 0) await run(tabId, "auto")
}

async function onContent(
  tabId: number,
  frame: AutofillFrame,
  message: ContentMessage
): Promise<void> {
  switch (message.type) {
    case "autofill-resolve-search":
      return
    case "autofill-scan":
      if (message.url !== scanUrl(frame.url)) return
      await takeScan(
        tabId,
        frame,
        (await frameVisible(tabId, frame)) === false
          ? { ...message, form: false, formLink: null, fields: [] }
          : message
      )
      await updateDetectionBadge(tabId, await autofillFrame(tabId))
      await refreshHost(tabId)
      return
    case "autofill-owned":
      await updateSession(tabId, (session) =>
        session && sameDocument(session, frame)
          ? markOwned(session, message.fieldIds)
          : session
      )
      return
    case "autofill-draft":
      return draft(tabId, message.fieldId, message.instruction)
    case "autofill-inserted":
      await updateSession(tabId, (session) =>
        session && sameDocument(session, frame)
          ? markDrafted(session, message.fieldId)
          : session
      )
      return
  }
}

/** Recheck the live target when a frame navigates, disappears or is hidden. */
async function refreshDetection(tabId: number): Promise<void> {
  const frame = await autofillFrame(tabId)
  await updateSession(tabId, (session) =>
    session &&
    (!frame ||
      !sameDocument(session, frame) ||
      session.url !== scanUrl(frame.url))
      ? { ...session, form: false, fields: [], formLink: null }
      : session
  )
  await updateDetectionBadge(tabId, frame)
  if (frame)
    await sendToContent(tabId, frame, { type: "autofill-rescan" }).catch(
      () => {}
    )
  await refreshHost(tabId)
}

const FrameChangeSchema = z.object({
  type: z.literal("autofill-frame-change"),
})

export function registerAutofill(): void {
  registerOrigin()
  chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined)
      return false
    if (sender.frameId === 0 && FrameChangeSchema.safeParse(raw).success) {
      respond({ ok: true })
      void refreshDetection(sender.tab.id).catch(() => {})
      return false
    }
    const parsed = ContentMessageSchema.safeParse(raw)
    if (!parsed.success) return false
    if (parsed.data.type === "autofill-resolve-search") {
      const message = parsed.data
      void contentFrame(sender)
        .then(async (from) => ({
          option: from
            ? await resolveSearchRequest(from.tabId, from.frame, message)
            : null,
        }))
        .then(respond, () => respond({ option: null }))
      return true
    }
    // The content script only learns that the message arrived.
    respond({ ok: true })
    void (async () => {
      const from = await contentFrame(sender)
      if (!from) return
      if (parsed.data.type !== "autofill-scan") {
        const session = await readSession(from.tabId)
        if (
          !session ||
          !sameDocument(session, from.frame) ||
          session.url !== scanUrl(from.frame.url)
        )
          return
      }
      await onContent(from.tabId, from.frame, parsed.data)
    })().catch(() => {})
    return false
  })
  const navigate = ({
    tabId,
    frameId,
    url,
    documentLifecycle,
  }: chrome.webNavigation.WebNavigationFramedCallbackDetails) => {
    if (documentLifecycle !== "active") return
    void (async () => {
      if (
        frameId === 0 ||
        autofillVendor(classifyPage(url)) !== null ||
        (await readSession(tabId))?.frameId === frameId
      )
        await refreshDetection(tabId)
    })().catch(() => {})
  }
  chrome.webNavigation.onCommitted.addListener(navigate)
  chrome.webNavigation.onHistoryStateUpdated.addListener(navigate)
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void refreshDetection(tabId).catch(() => {})
  })
}
