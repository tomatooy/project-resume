import type { z } from "zod"
import {
  type WorkerMessage,
  type WorkerReply,
  WorkerReplySchemas,
} from "../../lib/autofill-protocol"

const REPLIES: { [K in WorkerMessage["type"]]: z.ZodType<WorkerReply<K>> } =
  WorkerReplySchemas

const replyOf = <K extends WorkerMessage["type"]>(
  type: K
): z.ZodType<WorkerReply<K>> => REPLIES[type]

/**
 * Sends to the autofill content script in one frame of the tab, which is the
 * session's frame (0 without a session), and checks the reply's shape.
 */
export async function sendToContent<K extends WorkerMessage["type"]>(
  tabId: number,
  frameId: number,
  message: WorkerMessage & { type: K }
): Promise<WorkerReply<K>> {
  const reply: unknown = await chrome.tabs.sendMessage(tabId, message, {
    frameId,
  })
  return replyOf<K>(message.type).parse(reply)
}
