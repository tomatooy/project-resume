import {
  AxTreeSchema,
  DomDocumentSchema,
  type AxNode,
  type DomNode,
} from "../src/dom-agent/observation-payload"
import type { CdpConnection } from "./cdp-client"
import { encodeFixture, type Fixture } from "./fixture-format"

/**
 * One page, read the way the reader reads it, then frozen.
 *
 * The recorder asks the browser the same two questions the engine asks, with
 * one difference: it asks for the whole document, unbounded, because a fixture
 * has to be able to answer a later read at any depth. What the reader would
 * have been given at depth 40 is worked out while replaying, not at capture
 * time.
 *
 * The method names here are not the engine's reviewed list. This is a developer
 * tool run by hand against a browser the user owns, and the engine's allowlist
 * exists to bound what an assistant-driven run can reach, which is a different
 * question.
 */

/** What one context answered, or refused to. */
export type ContextRead = {
  kind: "document" | "frame"
  sessionId: string | null
  url: string | null
  document: DomNode | null
  ax: AxNode[]
  axFailed: boolean
}

function problemOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Reads one context. A context that refuses the document read is recorded as
 * having refused rather than dropped, so replaying reproduces the coverage gap
 * the live run would have reported.
 */
export async function readContext(
  connection: CdpConnection,
  input: {
    kind: "document" | "frame"
    sessionId: string | null
    url: string | null
  }
): Promise<ContextRead> {
  let document: DomNode | null = null
  try {
    const payload = await connection.send(
      "DOM.getDocument",
      { depth: -1, pierce: true },
      input.sessionId
    )
    const parsed = DomDocumentSchema.safeParse(payload)
    if (!parsed.success)
      throw new Error("the document shape was not recognised")
    document = parsed.data.root
  } catch (error) {
    if (input.kind === "document") throw error
    return {
      kind: input.kind,
      sessionId: input.sessionId,
      url: input.url,
      document: null,
      ax: [],
      axFailed: true,
    }
  }

  try {
    const payload = await connection.send(
      "Accessibility.getFullAXTree",
      {},
      input.sessionId
    )
    const parsed = AxTreeSchema.safeParse(payload)
    if (!parsed.success)
      return {
        kind: input.kind,
        sessionId: input.sessionId,
        url: input.url,
        document,
        ax: [],
        axFailed: true,
      }
    return {
      kind: input.kind,
      sessionId: input.sessionId,
      url: input.url,
      document,
      ax: parsed.data.nodes,
      axFailed: false,
    }
  } catch {
    return {
      kind: input.kind,
      sessionId: input.sessionId,
      url: input.url,
      document,
      ax: [],
      axFailed: true,
    }
  }
}

/** A cross-origin frame, as the browser lists it. */
function frameTargets(
  result: unknown
): Array<{ targetId: string; url: string }> {
  const infos = (result as { targetInfos?: unknown } | null)?.targetInfos
  if (!Array.isArray(infos)) return []
  const frames: Array<{ targetId: string; url: string }> = []
  for (const info of infos) {
    if (typeof info !== "object" || info === null) continue
    const record = info as Record<string, unknown>
    if (record.type !== "iframe" || typeof record.targetId !== "string")
      continue
    frames.push({
      targetId: record.targetId,
      url: typeof record.url === "string" ? record.url : "",
    })
  }
  return frames
}

/**
 * Every frame the page holds is a context the engine reads, and a
 * cross-origin one is only reachable through its own session: the tab's
 * session returns the frame element, never its contents.
 */
async function attachFrames(
  connection: CdpConnection,
  log: (line: string) => void
): Promise<Array<{ sessionId: string; url: string }>> {
  await connection.send("Target.setDiscoverTargets", { discover: true })
  const listed = await connection.send("Target.getTargets", {})
  const sessions: Array<{ sessionId: string; url: string }> = []
  for (const frame of frameTargets(listed)) {
    try {
      const attached = await connection.send("Target.attachToTarget", {
        targetId: frame.targetId,
        flatten: true,
      })
      const sessionId = (attached as { sessionId?: string } | null)?.sessionId
      if (!sessionId) throw new Error("no session was returned")
      sessions.push({ sessionId, url: frame.url })
    } catch (error) {
      log(
        `frame ${frame.url || frame.targetId}: not attached (${problemOf(error)})`
      )
    }
  }
  return sessions
}

export type CaptureOptions = {
  connection: CdpConnection
  site: string
  url: string
  extensionVersion: string
  name?: string
  capturedAt?: string
  log?: (line: string) => void
}

export async function capturePage(input: CaptureOptions): Promise<Fixture> {
  const log = input.log ?? (() => {})
  const sessions = await attachFrames(input.connection, log)
  try {
    const contexts: ContextRead[] = [
      await readContext(input.connection, {
        kind: "document",
        sessionId: null,
        url: input.url,
      }),
    ]
    for (const session of sessions)
      contexts.push(
        await readContext(input.connection, {
          kind: "frame",
          sessionId: session.sessionId,
          url: session.url,
        })
      )

    return encodeFixture({
      capture: {
        site: input.site,
        url: input.url,
        capturedAt: input.capturedAt ?? new Date().toISOString(),
        extensionVersion: input.extensionVersion,
        method: "cdp-websocket",
      },
      contexts,
    })
  } finally {
    // The user keeps their browser: a capture does not leave it attached.
    for (const session of sessions) {
      try {
        await input.connection.send("Target.detachFromTarget", {
          sessionId: session.sessionId,
        })
      } catch {
        // A session that is already gone is the state this wanted anyway.
      }
    }
  }
}

/** A one line summary for the user, before the fixture is written. */
export function describeFixture(fixture: Fixture): string {
  const lines = fixture.contexts.map((context) => {
    const nodes = countNodes(context.document)
    const state =
      context.document === null
        ? "document refused"
        : `${nodes} nodes, ${context.ax.length} accessibility nodes`
    return `  ${context.sessionId ?? "tab"} ${context.url ?? ""} (${state})`
  })
  return [
    `${fixture.capture.site} ${fixture.capture.url}`,
    ...lines,
    `  captured ${fixture.capture.capturedAt} by extension ${fixture.capture.extensionVersion}`,
  ].join("\n")
}

function countNodes(node: DomNode | null): number {
  if (!node) return 0
  let total = 1
  for (const child of node.children ?? []) total += countNodes(child)
  for (const shadow of node.shadowRoots ?? []) total += countNodes(shadow)
  if (node.contentDocument) total += countNodes(node.contentDocument)
  return total
}
