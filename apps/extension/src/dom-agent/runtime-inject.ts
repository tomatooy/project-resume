import type { CdpParams } from "./cdp"
import {
  RUNTIME_BUNDLE_FILE,
  RUNTIME_GLOBAL_PREFIX,
  RUNTIME_LIB_NAME,
  RUNTIME_VERSION,
  readReply,
  type RuntimeInstall,
  type RuntimeExpectation,
  type RuntimeReply,
  type RuntimeStep,
} from "./runtime/protocol"

/**
 * The worker's side of the page runtime: how the bundle is installed, how one
 * action reaches it, and how its answer is read back. Every string that the
 * page evaluates is fixed here or comes from the build output. Nothing from a
 * model, and nothing from a page, is ever concatenated into code.
 */

/** The one declaration used for every action, whatever the verb. */
export const DISPATCH_DECLARATION =
  "function (key, actionRef, questionRef, verb, step, expect, version) { return globalThis[key].call(this, actionRef, questionRef, verb, step, expect, version) }"

/**
 * Install, then read the installation back in the same evaluation. The bundle
 * assigns its IIFE to a global, so the completion value of the whole statement
 * would be undefined without the trailing call.
 */
export function installExpression(bundleText: string): string {
  return `${bundleText};\n${RUNTIME_LIB_NAME}.install()`
}

export function installParams(bundleText: string): CdpParams {
  return {
    expression: installExpression(bundleText),
    awaitPromise: false,
    returnByValue: true,
    // No executionContextId and no isolated world: the default context of a
    // session is the frame's main world, which is where a framework's own
    // value setters live.
  }
}

/**
 * One action, sent to the control the worker resolved from the current
 * observation. The control is the call target, so `this` in the page is the
 * element itself: no selector is ever written down.
 */
export function dispatchParams(input: {
  key: string
  elementObjectId: string
  actionRef: string
  questionRef: string
  step: RuntimeStep
  expect: RuntimeExpectation
}): CdpParams {
  return {
    objectId: input.elementObjectId,
    functionDeclaration: DISPATCH_DECLARATION,
    arguments: [
      { value: input.key },
      { value: input.actionRef },
      { value: input.questionRef },
      { value: input.step.kind },
      { value: input.step },
      { value: input.expect },
      { value: RUNTIME_VERSION },
    ],
    awaitPromise: true,
    returnByValue: true,
  }
}

/** Release the resolved control once its action is done. */
export function releaseParams(objectId: string): CdpParams {
  return { objectId }
}

/** The installation, refused when it is not the build this worker speaks. */
export function readInstall(value: unknown): RuntimeInstall | null {
  if (!isRecord(value)) return null
  const { version, nonce, key } = value
  if (version !== RUNTIME_VERSION) return null
  if (typeof nonce !== "string" || nonce.length === 0) return null
  if (typeof key !== "string" || !key.startsWith(`${RUNTIME_GLOBAL_PREFIX}_`))
    return null
  return { version, nonce, key }
}

/** The object id of a node the worker resolved through the protocol. */
export function remoteObjectId(result: unknown): string | null {
  if (!isRecord(result)) return null
  const remote = result.object
  if (!isRecord(remote)) return null
  const objectId = remote.objectId
  return typeof objectId === "string" && objectId.length > 0 ? objectId : null
}

/** The by-value result of an evaluation, before it is interpreted at all. */
export function remoteValue(result: unknown): unknown {
  if (!isRecord(result)) return null
  const remote = result.result
  if (!isRecord(remote)) return null
  return remote.value ?? null
}

/**
 * Read one reply out of a protocol result. A result that does not parse is not
 * an outcome: the caller reports the action as failed rather than guessing.
 */
export function replyFromCdpResult(result: unknown): RuntimeReply | null {
  return readReply(remoteValue(result))
}

export type BundleLoader = () => Promise<string>

/** The built runtime, read from the extension's own package. */
export function chromeBundleLoader(): BundleLoader {
  return async () => {
    const url = chrome.runtime.getURL(RUNTIME_BUNDLE_FILE)
    const response = await fetch(url)
    if (!response.ok)
      throw new Error(`Runtime bundle is unavailable: ${response.status}`)
    return response.text()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
