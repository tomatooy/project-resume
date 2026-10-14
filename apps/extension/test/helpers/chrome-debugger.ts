/**
 * Shared double for chrome.debugger.
 *
 * Every test on this path used to hand-roll its own stub, which meant the
 * protocol lifecycle was only ever as faithful as the newest copy. This one
 * models the parts the engine depends on: callback-free promises, a command
 * log, scriptable failure per method, and events that reach the listeners the
 * session actually registered.
 */

export type DebuggerCommand = {
  tabId: number
  sessionId: string | null
  method: string
  params: Record<string, unknown>
}

type Handler = (params: Record<string, unknown>) => unknown

export type DebuggerHarness = {
  /** Install as `chrome` before the code under test starts. */
  readonly chrome: { debugger: Record<string, unknown> }
  readonly commands: DebuggerCommand[]
  readonly attachedTabs: number[]
  /** Methods in call order, for asserting what the session actually probes. */
  methods(): string[]
  /** Answer a method. Without a handler a method resolves to `{}`. */
  on(method: string, handler: Handler): void
  /** Make a method reject as Chrome would when a domain is unavailable. */
  fail(method: string, message?: string): void
  /** Refuse attachment for a tab. */
  failAttach(tabId: number, message?: string): void
  /** Deliver a protocol event to every registered listener. */
  emit(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ): void
  /** Deliver a detach, as Chrome does when DevTools takes the tab. */
  emitDetach(reason?: string): void
  listenerCount(): { events: number; detaches: number }
}

type EventListener = (
  source: { tabId?: number; sessionId?: string },
  method: string,
  params?: object
) => void

type DetachListener = (
  source: { tabId?: number; sessionId?: string },
  reason: string
) => void

export function createDebuggerHarness(tabId = 1): DebuggerHarness {
  const commands: DebuggerCommand[] = []
  const attachedTabs: number[] = []
  const handlers = new Map<string, Handler>()
  const failures = new Map<string, string>()
  const attachFailures = new Map<number, string>()
  const eventListeners = new Set<EventListener>()
  const detachListeners = new Set<DetachListener>()

  const debuggerApi = {
    async attach(target: { tabId: number }): Promise<void> {
      const failure = attachFailures.get(target.tabId)
      if (failure) throw new Error(failure)
      attachedTabs.push(target.tabId)
    },
    async detach(target: { tabId: number }): Promise<void> {
      const index = attachedTabs.indexOf(target.tabId)
      if (index < 0) throw new Error("Not attached")
      attachedTabs.splice(index, 1)
    },
    async sendCommand(
      target: { tabId: number; sessionId?: string },
      method: string,
      params: Record<string, unknown> = {}
    ): Promise<unknown> {
      commands.push({
        tabId: target.tabId,
        sessionId: target.sessionId ?? null,
        method,
        params,
      })
      const failure = failures.get(method)
      if (failure) throw new Error(failure)
      const handler = handlers.get(method)
      return handler ? handler(params) : {}
    },
    onEvent: {
      addListener(listener: EventListener) {
        eventListeners.add(listener)
      },
      removeListener(listener: EventListener) {
        eventListeners.delete(listener)
      },
    },
    onDetach: {
      addListener(listener: DetachListener) {
        detachListeners.add(listener)
      },
      removeListener(listener: DetachListener) {
        detachListeners.delete(listener)
      },
    },
  }

  return {
    chrome: { debugger: debuggerApi },
    commands,
    attachedTabs,
    methods: () => commands.map((command) => command.method),
    on: (method, handler) => {
      handlers.set(method, handler)
    },
    fail: (method, message = `${method} failed`) => {
      failures.set(method, message)
    },
    failAttach: (tab, message = "Cannot attach") => {
      attachFailures.set(tab, message)
    },
    emit: (method, params = {}, sessionId) => {
      for (const listener of eventListeners)
        listener(sessionId ? { tabId, sessionId } : { tabId }, method, params)
    },
    emitDetach: (reason = "canceled_by_user") => {
      for (const listener of detachListeners) listener({ tabId }, reason)
    },
    listenerCount: () => ({
      events: eventListeners.size,
      detaches: detachListeners.size,
    }),
  }
}
