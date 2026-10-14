/**
 * The smallest DevTools Protocol client a capture needs.
 *
 * The extension talks to the browser through `chrome.debugger`, which is not
 * available to a script running outside an extension. A capture therefore
 * speaks the same protocol over the websocket Chrome exposes for its debugging
 * port, and this file is that channel and nothing more: the recorder's own
 * behaviour is in `capture-page.ts`, which takes the connection as an argument
 * so it can be exercised without a browser.
 */

export type CdpSocket = {
  send(data: string): void
  close(): void
  onMessage(handler: (data: string) => void): void
  onClose(handler: () => void): void
}

export type CdpTarget = {
  id: string
  type: string
  url: string
  title: string
  webSocketDebuggerUrl: string | null
}

export type CdpConnection = {
  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string | null
  ): Promise<unknown>
  /** Protocol events, which is how a child session announces itself. */
  on(
    method: string,
    handler: (params: Record<string, unknown>, sessionId: string) => void
  ): void
  close(): void
}

export class CdpError extends Error {
  constructor(
    readonly method: string,
    message: string
  ) {
    super(`${method}: ${message}`)
  }
}

type PendingEntry = {
  method: string
  timer: ReturnType<typeof setTimeout>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export function createCdpConnection(
  socket: CdpSocket,
  timeoutMs = 30_000
): CdpConnection {
  let nextId = 1
  const pending = new Map<number, PendingEntry>()
  const listeners = new Map<
    string,
    Array<(params: Record<string, unknown>, sessionId: string) => void>
  >()
  let closed = false

  /** Takes an entry out of the table and stops its timeout. */
  const take = (id: number): PendingEntry | undefined => {
    const entry = pending.get(id)
    if (!entry) return undefined
    clearTimeout(entry.timer)
    pending.delete(id)
    return entry
  }

  socket.onClose(() => {
    closed = true
    // Every wait fails rather than hanging: a capture that lost its browser
    // must say so instead of sitting on a promise until the user gives up.
    for (const [id, entry] of [...pending]) {
      take(id)
      entry.reject(new CdpError(entry.method, "the connection closed"))
    }
  })

  socket.onMessage((data) => {
    let message: {
      id?: number
      method?: string
      params?: Record<string, unknown>
      sessionId?: string
      result?: unknown
      error?: { message?: string }
    }
    try {
      message = JSON.parse(data)
    } catch {
      return
    }
    if (typeof message.id === "number") {
      const entry = take(message.id)
      if (!entry) return
      if (message.error)
        entry.reject(
          new CdpError(entry.method, message.error.message ?? "failed")
        )
      else entry.resolve(message.result)
      return
    }
    if (!message.method) return
    for (const listener of listeners.get(message.method) ?? [])
      listener(message.params ?? {}, message.sessionId ?? "")
  })

  return {
    send(method, params = {}, sessionId = null) {
      if (closed)
        return Promise.reject(new CdpError(method, "the connection closed"))
      const id = nextId
      nextId += 1
      return new Promise((resolve, reject) => {
        // A protocol call that never answers would otherwise hang the capture
        // with nothing on screen to explain it.
        const timer = setTimeout(() => {
          take(id)
          reject(new CdpError(method, `no answer within ${timeoutMs}ms`))
        }, timeoutMs)
        pending.set(id, { method, timer, resolve, reject })
        socket.send(
          JSON.stringify(
            sessionId
              ? { id, method, params, sessionId }
              : { id, method, params }
          )
        )
      })
    },
    on(method, handler) {
      const list = listeners.get(method) ?? []
      list.push(handler)
      listeners.set(method, list)
    },
    close() {
      if (closed) return
      closed = true
      socket.close()
    },
  }
}

/** The real websocket, adapted to the shape the recorder is written against. */
function browserSocket(url: string): Promise<CdpSocket> {
  const socket = new WebSocket(url)
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () =>
      resolve({
        send: (data) => socket.send(data),
        close: () => socket.close(),
        onMessage: (handler) =>
          socket.addEventListener("message", (event) =>
            handler(String(event.data))
          ),
        onClose: (handler) => socket.addEventListener("close", () => handler()),
      })
    )
    socket.addEventListener("error", () =>
      reject(new Error(`could not connect to ${url}`))
    )
  })
}

export async function connectCdp(webSocketUrl: string): Promise<CdpConnection> {
  return createCdpConnection(await browserSocket(webSocketUrl))
}

function asTarget(value: unknown): CdpTarget | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const id = record.id
  const type = record.type
  if (typeof id !== "string" || typeof type !== "string") return null
  return {
    id,
    type,
    url: typeof record.url === "string" ? record.url : "",
    title: typeof record.title === "string" ? record.title : "",
    webSocketDebuggerUrl:
      typeof record.webSocketDebuggerUrl === "string"
        ? record.webSocketDebuggerUrl
        : null,
  }
}

/**
 * Chrome lists its debuggable targets over plain HTTP next to the port. A
 * browser without the port answers nothing here, which is the most common way a
 * capture fails, so the message says what to start.
 */
export async function listTargets(
  port: number,
  fetchImpl: typeof fetch = fetch
): Promise<CdpTarget[]> {
  const url = `http://127.0.0.1:${port}/json/list`
  let response: Response
  try {
    response = await fetchImpl(url)
  } catch {
    throw new Error(
      `nothing is listening on ${url}: start Chrome with --remote-debugging-port=${port}`
    )
  }
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const body: unknown = await response.json()
  if (!Array.isArray(body))
    throw new Error(`${url} did not answer a target list`)
  const targets: CdpTarget[] = []
  for (const entry of body) {
    const target = asTarget(entry)
    if (target) targets.push(target)
  }
  return targets
}

/** The one page to capture, or a refusal naming what else was open. */
export function pickPageTarget(
  targets: CdpTarget[],
  match: string | null
): CdpTarget {
  const pages = targets.filter(
    (target) => target.type === "page" && target.webSocketDebuggerUrl
  )
  const matching = match
    ? pages.filter((target) => target.url.includes(match))
    : pages
  if (matching.length === 1) return matching[0] as CdpTarget
  if (matching.length === 0) {
    const open = pages.map((target) => `  ${target.url}`).join("\n")
    throw new Error(
      match
        ? `no open page matched "${match}". Open it in the browser window, then:\n${open}`
        : `no open page to capture:\n${open}`
    )
  }
  throw new Error(
    `${
      matching.length
    } pages matched; pass --match with part of the one you mean:\n${matching
      .map((target) => `  ${target.url}`)
      .join("\n")}`
  )
}
