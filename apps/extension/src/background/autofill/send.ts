import type { z } from "zod"
import {
  type WorkerMessage,
  type WorkerReply,
  WorkerReplySchemas,
} from "../../lib/autofill-protocol"
import {
  autofillFrames,
  type ContentTarget,
  frameVisible,
  sameDocument,
} from "./frames"

const REPLIES: { [K in WorkerMessage["type"]]: z.ZodType<WorkerReply<K>> } =
  WorkerReplySchemas

const replyOf = <K extends WorkerMessage["type"]>(
  type: K
): z.ZodType<WorkerReply<K>> => REPLIES[type]

/** Document targeting prevents a replaced iframe from receiving old writes. */
export async function sendToContent<K extends WorkerMessage["type"]>(
  tabId: number,
  target: ContentTarget,
  message: WorkerMessage & { type: K }
): Promise<WorkerReply<K>> {
  const frame = (await autofillFrames(tabId)).find((candidate) =>
    sameDocument(candidate, target)
  )
  if (!frame) throw new Error("The application frame changed.")
  if (
    [
      "autofill-write",
      "autofill-attach",
      "autofill-clear",
      "autofill-prepare",
    ].includes(message.type) &&
    (await frameVisible(tabId, frame)) === false
  )
    throw new Error("Open the application form on the page.")
  const reply: unknown = await chrome.tabs.sendMessage(
    tabId,
    { ...message, postingKey: target.postingKey },
    { documentId: target.documentId }
  )
  return replyOf<K>(message.type).parse(reply)
}
