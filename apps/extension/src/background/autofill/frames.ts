import { z } from "zod"
import { autofillVendor, classifyPage } from "../../lib/pages"
import { readSession, type ScanFrame } from "./session"

export type AutofillFrame = ScanFrame & {
  url: string
  parentFrameId: number
}

export type ContentTarget = Pick<ScanFrame, "frameId" | "documentId"> & {
  postingKey?: string | null
}

export function sameDocument(
  left: ContentTarget,
  right: ContentTarget
): boolean {
  return left.frameId === right.frameId && left.documentId === right.documentId
}

export function scanUrl(url: string): string {
  const parsed = new URL(url)
  return parsed.origin + parsed.pathname
}

/** Chrome's live frame URLs also follow navigation inside an embed. */
export async function autofillFrames(tabId: number): Promise<AutofillFrame[]> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId })
    return (frames ?? []).flatMap((frame) => {
      const vendor = autofillVendor(classifyPage(frame.url))
      return vendor &&
        !frame.errorOccurred &&
        frame.documentLifecycle === "active"
        ? [
            {
              frameId: frame.frameId,
              documentId: frame.documentId,
              parentFrameId: frame.parentFrameId,
              url: frame.url,
              vendor,
            },
          ]
        : []
    })
  } catch {
    return []
  }
}

/** Keep the current document; competing embeds never take over its session. */
export async function autofillFrame(
  tabId: number
): Promise<AutofillFrame | null> {
  const [frames, session] = await Promise.all([
    autofillFrames(tabId),
    readSession(tabId),
  ])
  const top = frames.find((frame) => frame.frameId === 0)
  if (top) return top
  const current =
    session && frames.find((frame) => sameDocument(frame, session))
  return current || (frames.length === 1 ? (frames[0] ?? null) : null)
}

const VisibilityReply = z.object({ visible: z.boolean().nullable() })

/** The parent host can distinguish a hidden iframe from one below the fold. */
export async function frameVisible(
  tabId: number,
  frame: AutofillFrame
): Promise<boolean | null> {
  if (frame.frameId === 0) return true
  try {
    const reply: unknown = await chrome.tabs.sendMessage(
      tabId,
      { type: "autofill-frame-state", origin: new URL(frame.url).origin },
      { frameId: frame.parentFrameId }
    )
    const parsed = VisibilityReply.safeParse(reply)
    return parsed.success ? parsed.data.visible : null
  } catch {
    return null
  }
}

export async function updateDetectionBadge(
  tabId: number,
  frame: AutofillFrame | null
): Promise<void> {
  await chrome.action
    .setBadgeText({ tabId, text: frame && frame.frameId > 0 ? "ATS" : "" })
    .catch(() => {})
}
