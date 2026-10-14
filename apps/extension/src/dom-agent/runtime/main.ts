import { createRuntimeState, handleDispatch } from "./dispatch"
import {
  RUNTIME_GLOBAL_PREFIX,
  RUNTIME_VERSION,
  type RuntimeInstall,
  type RuntimeReply,
} from "./protocol"
import { watchUserEdits } from "./user-edits"

/**
 * The bundle entry. Evaluating this file installs one dispatch function in the
 * page's main world; the worker then calls it with the control as the target
 * and everything else as data. Keep the exports to this one function: the build
 * turns them into the IIFE global the install expression reads.
 */

/** One install per document. A re-install returns the installation already made. */
let installed: RuntimeInstall | null = null

export function install(): RuntimeInstall {
  if (installed) return installed
  const nonce = newNonce()
  const key = `${RUNTIME_GLOBAL_PREFIX}_${nonce}`
  const state = createRuntimeState()
  // The page counts the user's own edits from here, so an action planned
  // before one of them is refused rather than written over the user's work.
  watchUserEdits(state)
  // The key is per-install so a page left holding a runtime from an earlier
  // extension build cannot be addressed by the current one.
  globalSlots()[key] = function (
    this: unknown,
    actionRef: unknown,
    questionRef: unknown,
    verb: unknown,
    step: unknown,
    expect: unknown,
    version: unknown
  ): Promise<RuntimeReply> {
    return handleDispatch.call(
      this,
      actionRef,
      questionRef,
      verb,
      step,
      expect,
      version,
      state
    )
  }
  installed = { version: RUNTIME_VERSION, nonce, key }
  return installed
}

function newNonce(): string {
  const source = globalThis.crypto
  if (source && typeof source.randomUUID === "function")
    return source.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** Globals are indexed by a per-install key, which no declaration can name. */
function globalSlots(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>
}
