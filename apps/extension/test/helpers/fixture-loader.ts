import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import type { CdpTransport } from "../../src/dom-agent/cdp"
import type { DomNode } from "../../src/dom-agent/observation-payload"
import {
  FIXTURES_RELATIVE,
  FIXTURE_SUFFIX,
  decodeFixture,
  encodeFixture,
  type Fixture,
  type FixtureCapture,
} from "../../tools/fixture-format"
import {
  buildPage,
  createPageTransport,
  type BuiltPage,
  type PageTransport,
} from "./cdp-page"
import type { DebuggerHarness } from "./chrome-debugger"

/**
 * Replaying a recorded page through the reader.
 *
 * Ticket 04 left this seam open: `createPageTransport` serves protocol payloads
 * built from markup, and a fixture is the same payloads taken from a real page.
 * The two differ in one thing worth modelling, which is that a recording can
 * answer a read at any depth, so a replay cuts the recorded tree the way the
 * browser would have.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, "..", "..")
export const FIXTURES_DIR = join(PACKAGE_ROOT, ...FIXTURES_RELATIVE.split("/"))

/**
 * A stand-in is not a capture. Its metadata says so, so a fixture built from
 * markup can never be mistaken for a page someone opened.
 */
const STAND_IN: FixtureCapture = {
  site: "stand-in",
  url: "stand-in://markup",
  capturedAt: "2026-01-01T00:00:00.000Z",
  extensionVersion: "stand-in",
  method: "markup-stand-in",
}

export type FixturePageInput = {
  root: BuiltPage
  frames?: Array<{ sessionId: string; url?: string | null; page: BuiltPage }>
  capture?: Partial<FixtureCapture>
  /** Off only to compare a pruned recording against the payload it came from. */
  prune?: boolean
}

/**
 * Turns a built page into the recording the loader reads. The result goes
 * through JSON on the way, so a test exercises the same shape a file has.
 */
export function recordPage(input: FixturePageInput): Fixture {
  const capture = { ...STAND_IN, ...input.capture }
  const fixture = encodeFixture({
    prune: input.prune !== false,
    capture,
    contexts: [
      {
        kind: "document" as const,
        sessionId: null,
        url: capture.url,
        document: input.root.dom,
        ax: input.root.ax,
      },
      ...(input.frames ?? []).map((frame) => ({
        kind: "frame" as const,
        sessionId: frame.sessionId,
        url: frame.url ?? null,
        document: frame.page.dom,
        ax: frame.page.ax,
      })),
    ],
  })
  return assertFixture(JSON.parse(JSON.stringify(fixture)))
}

function assertFixture(value: unknown): Fixture {
  const decoded = decodeFixture(value)
  if (!decoded.ok)
    throw new Error(`the recording did not load: ${decoded.problem}`)
  return decoded.fixture
}

/** A recorded document cut to the depth the caller asked for. */
export function truncateDocument(node: DomNode, depth: number): DomNode {
  if (depth < 0) return node
  const cut: DomNode = { ...node }
  if (depth === 0) {
    // The child count stays: it is how the reader sees that a subtree was cut.
    delete cut.children
    delete cut.shadowRoots
    delete cut.contentDocument
    return cut
  }
  if (node.children)
    cut.children = node.children.map((child) =>
      truncateDocument(child, depth - 1)
    )
  if (node.shadowRoots)
    cut.shadowRoots = node.shadowRoots.map((child) =>
      truncateDocument(child, depth - 1)
    )
  if (node.contentDocument)
    cut.contentDocument = truncateDocument(node.contentDocument, depth - 1)
  return cut
}

function findNode(node: DomNode, backendNodeId: number): DomNode | null {
  if (node.backendNodeId === backendNodeId) return node
  for (const child of node.children ?? []) {
    const found = findNode(child, backendNodeId)
    if (found) return found
  }
  for (const shadow of node.shadowRoots ?? []) {
    const found = findNode(shadow, backendNodeId)
    if (found) return found
  }
  return node.contentDocument
    ? findNode(node.contentDocument, backendNodeId)
    : null
}

/**
 * The reader asks for a document at one depth and for a node's own subtree at
 * another. A recording keeps the whole tree, so both are answered by cutting it
 * to what was asked for rather than by handing over more than the browser would.
 */
function depthModel(page: PageTransport): PageTransport {
  const transport: CdpTransport = {
    async send(sessionId, method, params) {
      const depth = typeof params?.depth === "number" ? params.depth : -1
      if (method === "DOM.getDocument") {
        const answer = (await page.transport.send(
          sessionId,
          method,
          params
        )) as {
          root: DomNode
        }
        return { ...answer, root: truncateDocument(answer.root, depth) }
      }
      if (method === "DOM.describeNode") {
        try {
          // A describe a test registered by hand wins over the recording.
          const answer = (await page.transport.send(
            sessionId,
            method,
            params
          )) as { node?: DomNode }
          return answer.node
            ? { ...answer, node: truncateDocument(answer.node, depth) }
            : answer
        } catch (error) {
          const id = Number(params?.backendNodeId)
          const document = recordedDocument(page, sessionId, id)
          if (!document)
            throw error instanceof Error ? error : new Error(String(error))
          return { node: truncateDocument(document, depth) }
        }
      }
      return page.transport.send(sessionId, method, params)
    },
  }
  return { ...page, transport }
}

/**
 * The recorded tree for one context, so a describe node call can be answered
 * the way the browser would have: the node's own subtree, cut to the depth
 * asked for.
 */
function recordedDocument(
  page: PageTransport,
  sessionId: string | null,
  backendNodeId: number
): DomNode | null {
  const held = recorded.get(page)
  const document = held?.get(sessionId ?? "root")
  if (!document) return null
  return findNode(document, backendNodeId)
}

/** The documents a replayed page serves, kept beside it for describes. */
const recorded = new WeakMap<PageTransport, Map<string, DomNode>>()

export function pageFromFixture(fixture: Fixture): PageTransport {
  const page = createPageTransport()
  const documents = new Map<string, DomNode>()
  for (const context of fixture.contexts) {
    if (context.document) {
      documents.set(context.sessionId ?? "root", context.document)
      page.setDocument(context.sessionId, {
        dom: context.document,
        ax: context.ax,
        elements: new Map(),
      })
    }
    // A context that refused the read refuses here too, so the coverage gap it
    // caused is part of what the recording replays.
    if (context.axFailed)
      page.fail(
        "Accessibility.getFullAXTree",
        "the accessibility tree could not be read in this context",
        context.sessionId
      )
  }
  recorded.set(page, documents)
  return depthModel(page)
}

/** Markup through the same load path a recording takes. */
export function pageFromMarkup(
  html: string,
  input?: Omit<FixturePageInput, "root">
): PageTransport {
  return pageFromFixture(recordPage({ ...input, root: buildPage(html) }))
}

/**
 * A recording's frames were attached during the capture, so a replay attaches
 * them again: the reader only ever reads a context it was told about.
 */
export function emitRecordedFrames(
  harness: DebuggerHarness,
  fixture: Fixture
): void {
  for (const context of fixture.contexts) {
    if (context.kind !== "frame" || !context.sessionId) continue
    harness.emit(
      "Target.attachedToTarget",
      {
        sessionId: context.sessionId,
        targetInfo: { targetId: context.sessionId, url: context.url ?? "" },
      },
      context.sessionId
    )
  }
}

export function loadFixture(name: string, base = FIXTURES_DIR): Fixture {
  const path = join(base, name)
  const decoded = decodeFixture(JSON.parse(readFileSync(path, "utf8")))
  if (!decoded.ok)
    throw new Error(`${relative(base, path)}: ${decoded.problem}`)
  return decoded.fixture
}

/** Every recording under a directory, so a suite runs against what has landed. */
export function listFixtures(base = FIXTURES_DIR): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (entry.endsWith(FIXTURE_SUFFIX)) found.push(relative(base, path))
    }
  }
  walk(base)
  return found.sort()
}
