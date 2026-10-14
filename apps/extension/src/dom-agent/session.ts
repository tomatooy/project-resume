import {
  type CdpMethod,
  type CdpParams,
  type CdpTransport,
  chromeCdpTransport,
  UnreviewedMethodError,
} from "./cdp"

/**
 * What the protocol actually gave us. Experimental support is never assumed
 * from a successful attachment, so accessibility is probed with a real read.
 */
export type DriverCapability = {
  accessibility: boolean
  dom: boolean
  childSessions: boolean
}

export type InvalidationReason =
  | "navigation"
  | "document_replaced"
  | "execution_context_cleared"
  | "execution_context_destroyed"
  | "frame_detached"
  | "child_detached"
  | "detached"
  | "tab_closed"
  | "cancelled"

export type DriverContext = {
  id: string
  kind: "document" | "frame" | "shadow_root"
  sessionId: string | null
  frameId: string | null
  url: string | null
}

export class DriverClosedError extends Error {
  constructor() {
    super("The debugging session is closed")
  }
}

/** The context a reference belonged to is gone; re-observe before acting. */
export class StaleContextError extends Error {
  constructor(readonly contextId: string) {
    super(`Context ${contextId} is no longer part of this observation`)
  }
}

/** The page changed while a command was in flight, so its result is worthless. */
export class StaleResultError extends Error {
  constructor(readonly method: string) {
    super(`${method} was overtaken by a page change`)
  }
}

/** Commands that end the session or replace the document are never issued. */
const INVALIDATING_EVENTS: Readonly<Record<string, InvalidationReason>> = {
  "Page.frameNavigated": "navigation",
  "Page.frameDetached": "frame_detached",
  "DOM.documentUpdated": "document_replaced",
  "Runtime.executionContextsCleared": "execution_context_cleared",
  "Runtime.executionContextDestroyed": "execution_context_destroyed",
  "Target.detachedFromTarget": "child_detached",
}

const CHILD_ATTACHED = "Target.attachedToTarget"

type Listener = (reason: InvalidationReason) => void

/**
 * One attached debugging session for one tab, owned by one run.
 *
 * A session is opened for a run and closed with it. Nothing here caches
 * capability across attachments: a restarted worker reattaches, re-probes and
 * re-observes before any further write, because a protocol session cannot
 * outlive the worker that opened it.
 */
export class DriverSession {
  readonly tabId: number
  readonly runId: string
  private readonly transport: CdpTransport
  private readonly listeners = new Set<Listener>()
  private readonly contexts = new Map<string, DriverContext>()
  private capabilityValue?: DriverCapability
  private generationValue = 0
  private closed = false
  private childListener?: (
    source: chrome.debugger.DebuggerSession,
    method: string,
    params?: object
  ) => void
  private detachListener?: (
    source: chrome.debugger.Debuggee,
    reason: string
  ) => void

  private constructor(input: {
    tabId: number
    runId: string
    transport: CdpTransport
  }) {
    this.tabId = input.tabId
    this.runId = input.runId
    this.transport = input.transport
  }

  /**
   * Attach, then prove what is actually available. `runId` is required so an
   * attachment cannot be expressed without a run that owns it.
   */
  static async attach(input: {
    tabId: number
    runId: string
    transport?: CdpTransport
  }): Promise<DriverSession> {
    if (!input.runId) throw new Error("A debugging session needs a run")
    const session = new DriverSession({
      tabId: input.tabId,
      runId: input.runId,
      transport: input.transport ?? chromeCdpTransport(input.tabId),
    })
    await session.open()
    return session
  }

  private async open(): Promise<void> {
    await chrome.debugger.attach({ tabId: this.tabId }, "1.3")
    this.closed = false
    this.generationValue = 1
    this.registerLifecycle()
    await this.probe()
  }

  /** Asked of the browser, not assumed from the attachment succeeding. */
  private async probe(): Promise<void> {
    let dom = false
    let accessibility = false
    let childSessions = false
    try {
      await this.transport.send(null, "DOM.enable")
      await this.transport.send(null, "DOM.getDocument", {
        depth: 0,
        pierce: false,
      })
      dom = true
    } catch {
      dom = false
    }
    try {
      await this.transport.send(null, "Accessibility.enable")
      await this.transport.send(null, "Accessibility.getFullAXTree", {})
      accessibility = true
    } catch {
      accessibility = false
    }
    try {
      await this.transport.send(null, "Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      })
      childSessions = true
    } catch {
      childSessions = false
    }
    // Page and Runtime are only needed for navigation and injection. Their
    // absence is not fatal on its own, so they are enabled best-effort.
    for (const method of ["Page.enable", "Runtime.enable"] as const) {
      try {
        await this.transport.send(null, method)
      } catch {
        // Not fatal on its own.
      }
    }
    this.capabilityValue = { accessibility, dom, childSessions }
    this.addContext({
      id: "root",
      kind: "document",
      sessionId: null,
      frameId: null,
      url: null,
    })
  }

  get capability(): DriverCapability {
    if (!this.capabilityValue) throw new DriverClosedError()
    return this.capabilityValue
  }

  /** Filling needs real accessibility semantics; there is no fallback reader. */
  get fillable(): boolean {
    return !this.closed && this.capabilityValue?.accessibility === true
  }

  get generation(): number {
    return this.generationValue
  }

  get contextList(): DriverContext[] {
    return [...this.contexts.values()]
  }

  context(id: string): DriverContext | undefined {
    return this.contexts.get(id)
  }

  onInvalidate(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Send on behalf of one context. The generation is read before the command
   * and checked after it, so a result that arrives across a navigation is
   * discarded rather than acted on.
   */
  async send(
    contextId: string,
    method: CdpMethod,
    params?: CdpParams
  ): Promise<unknown> {
    if (this.closed) throw new DriverClosedError()
    const context = this.contexts.get(contextId)
    if (!context) throw new StaleContextError(contextId)
    const before = this.generationValue
    const result = await this.transport.send(context.sessionId, method, params)
    if (before !== this.generationValue) throw new StaleResultError(method)
    return result
  }

  /** Everything observed so far belongs to a generation that has ended. */
  invalidate(reason: InvalidationReason): void {
    if (this.closed) return
    this.generationValue += 1
    this.contexts.clear()
    for (const listener of this.listeners) listener(reason)
  }

  async detach(reason: InvalidationReason = "cancelled"): Promise<void> {
    if (this.closed) return
    // Release accessibility observation before letting go of the session.
    try {
      await this.transport.send(null, "Accessibility.disable")
    } catch {
      // Already gone.
    }
    this.closed = true
    this.contexts.clear()
    this.unregisterLifecycle()
    try {
      await chrome.debugger.detach({ tabId: this.tabId })
    } catch {
      // Already detached: the tab closed, or another client took it.
    }
    for (const listener of this.listeners) listener(reason)
  }

  private addContext(context: DriverContext): void {
    this.contexts.set(context.id, context)
  }

  private registerLifecycle(): void {
    this.childListener = (source, method, params) => {
      if (source.tabId !== this.tabId) return
      const childSession = source.sessionId ?? null
      if (method === CHILD_ATTACHED) {
        const attached = params as
          | {
              sessionId?: string
              targetInfo?: { targetId?: string; url?: string }
            }
          | undefined
        const id = attached?.sessionId
        if (!id) return
        this.addContext({
          id,
          kind: "frame",
          sessionId: id,
          frameId: attached.targetInfo?.targetId ?? null,
          url: attached.targetInfo?.url ?? null,
        })
        return
      }
      const reason = INVALIDATING_EVENTS[method]
      if (!reason) return
      if (method === "Runtime.executionContextDestroyed") {
        // One context died, not the document: drop only the child that owns it.
        if (childSession) this.contexts.delete(childSession)
        this.invalidate(reason)
        return
      }
      this.invalidate(reason)
    }
    chrome.debugger.onEvent.addListener(this.childListener)
    this.detachListener = (source, reason) => {
      if (source.tabId !== this.tabId) return
      this.closed = true
      this.contexts.clear()
      this.unregisterLifecycle()
      const mapped: InvalidationReason =
        reason === "target_closed" ? "tab_closed" : "detached"
      for (const listener of this.listeners) listener(mapped)
    }
    chrome.debugger.onDetach.addListener(this.detachListener)
  }

  private unregisterLifecycle(): void {
    if (this.childListener) {
      chrome.debugger.onEvent.removeListener(this.childListener)
      this.childListener = undefined
    }
    if (this.detachListener) {
      chrome.debugger.onDetach.removeListener(this.detachListener)
      this.detachListener = undefined
    }
  }
}

export { UnreviewedMethodError }
