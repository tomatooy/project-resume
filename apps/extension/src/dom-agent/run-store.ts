import {
  DOM_AGENT_LIMITS,
  RunCheckpointSchema,
  type RunCheckpoint,
  accountStatePrefix,
} from "@workspace/resume-core/dom-agent"
import { prepareResumePdf } from "../autofill/pdf-background"
import type { AttachmentSource, RunStore } from "./run-coordinator"

/**
 * The extension's own implementation of the two things a run needs from
 * outside itself: somewhere for the checkpoint to live, and the bytes for the
 * resume attachment.
 *
 * Session storage, not local: a checkpoint holds one page run's temporary
 * state and belongs to the tab and application that produced it. It outlives a
 * service worker, which is what a worker restart has to survive, and it is
 * dropped when the browser session ends, which is what the spec means by a
 * browser restart beginning a new temporary session.
 */

export function sessionRunStore(): RunStore {
  return {
    async load(stateKey: string): Promise<RunCheckpoint | null> {
      const held = await chrome.storage.session.get(stateKey)
      // A checkpoint that no longer parses is dropped rather than patched:
      // a run resumed from a shape it cannot read is worse than one that
      // starts again.
      const parsed = RunCheckpointSchema.safeParse(held[stateKey])
      return parsed.success ? parsed.data : null
    },
    async save(checkpoint: RunCheckpoint): Promise<void> {
      await chrome.storage.session.set({ [checkpoint.stateKey]: checkpoint })
    },
    async clear(stateKey: string): Promise<void> {
      await chrome.storage.session.remove(stateKey)
    },
  }
}

/** Signing out drops every tab's run state for that account at once. */
export async function clearAccountRuns(accountId: string): Promise<void> {
  const held = await chrome.storage.session.get(null)
  const prefix = accountStatePrefix(accountId)
  const keys = Object.keys(held).filter((key) => key.startsWith(prefix))
  if (keys.length > 0) await chrome.storage.session.remove(keys)
}

/**
 * The resume attachment, rendered from the pinned bundle. The bytes are cached
 * by an identity that covers the document and every choice that changes its
 * appearance, and the action carries that identity, so the page refuses bytes
 * rendered for a different document or template.
 */
export function resumeAttachmentSource(input: {
  resumeId: string
  bundleId: string
  accountId?: string
}): AttachmentSource {
  return {
    async render() {
      const file = await prepareResumePdf(
        input.resumeId,
        input.bundleId,
        AbortSignal.timeout(DOM_AGENT_LIMITS.uploadMs),
        input.accountId
      )
      return {
        identity: file.pdfId,
        name: file.filename,
        type: "application/pdf",
        sizeBytes: file.byteLength,
        base64: file.base64,
      }
    },
  }
}
