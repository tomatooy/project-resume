/**
 * The reviewed slice of the DevTools Protocol this engine may reach.
 *
 * Naming every method here is deliberate. A generic `send(method, params)` on
 * the real Chrome API would let any caller reach any domain, including ones
 * that navigate, submit, or run arbitrary script, and the same discipline that
 * keeps a generic click out of the action vocabulary applies to the protocol.
 */
export const CDP_METHODS = [
  "Accessibility.disable",
  "Accessibility.enable",
  "Accessibility.getFullAXTree",
  "CSS.enable",
  "CSS.getComputedStyleForNode",
  "DOM.describeNode",
  "DOM.disable",
  "DOM.enable",
  "DOM.getBoxModel",
  "DOM.getDocument",
  "DOM.pushNodesByBackendIdsToFrontend",
  "DOM.resolveNode",
  "Page.disable",
  "Page.enable",
  "Page.getFrameTree",
  // Not a widening of the ceiling: Runtime.evaluate already runs script owned by
  // the extension. This is the only way to hand a control the worker resolved
  // to the injected runtime as an argument rather than as a selector.
  "Runtime.callFunctionOn",
  "Runtime.disable",
  "Runtime.enable",
  "Runtime.evaluate",
  "Runtime.releaseObject",
  "Target.attachToTarget",
  "Target.getTargets",
  "Target.setAutoAttach",
] as const

export type CdpMethod = (typeof CDP_METHODS)[number]

const REVIEWED = new Set<string>(CDP_METHODS)

export function isReviewedMethod(method: string): method is CdpMethod {
  return REVIEWED.has(method)
}

export type CdpParams = Record<string, unknown>

/**
 * One protocol channel: the tab itself, or a child session for an
 * out-of-process frame. Child sessions are addressed by identity taken from
 * the attachment event, never by guessing a frame number.
 */
export interface CdpTransport {
  send(
    sessionId: string | null,
    method: CdpMethod,
    params?: CdpParams
  ): Promise<unknown>
}

export class UnreviewedMethodError extends Error {
  constructor(method: string) {
    super(`Unreviewed protocol method: ${method}`)
  }
}

/** The real transport. The only place chrome.debugger is called from. */
export function chromeCdpTransport(tabId: number): CdpTransport {
  return {
    async send(sessionId, method, params) {
      if (!isReviewedMethod(method)) throw new UnreviewedMethodError(method)
      const target = sessionId ? { tabId, sessionId } : { tabId }
      return chrome.debugger.sendCommand(target, method, params ?? {})
    },
  }
}
