import { z } from "zod"
import {
  AxNodeSchema,
  DomNodeSchema,
  type AxNode,
  type DomNode,
} from "../src/dom-agent/observation-payload"

/**
 * The shape of a recorded page, and the prune that keeps one committable.
 *
 * A recording is a page frozen at one moment: the protocol payloads the reader
 * would have received, so a run can be replayed offline. It is the only copy of
 * a real acceptance page, which makes the prune the risky half: a field dropped
 * here cannot be read by a test until the page is captured again. Everything
 * kept below is therefore kept because the reader reads it, and the README in
 * `test/fixtures` states what that costs.
 */

export const FIXTURE_KIND = "dom-agent-fixture"

/**
 * Bumped when the shape changes. A loader that meets a newer version refuses
 * rather than guessing, because a fixture that parses wrongly reads as a page
 * that behaved differently.
 */
export const FIXTURE_VERSION = 1

/** Every file under `test/fixtures/<site>` is one of these. */
export const FIXTURE_SUFFIX = ".json"

/**
 * Where recordings live, relative to the extension package. The recorder
 * writes here and the loader reads here, so it is one constant rather than two
 * paths that have to agree.
 */
export const FIXTURES_RELATIVE = "test/fixtures"

const CaptureSchema = z.strictObject({
  site: z.string().min(1).max(64),
  url: z.string().min(1).max(4000),
  capturedAt: z.iso.datetime(),
  /** The version of the extension that took the capture, from its manifest. */
  extensionVersion: z.string().min(1).max(64),
  /** How it was taken, so a fixture older than the recorder is still readable. */
  method: z.string().min(1).max(64),
})

const FixtureContextSchema = z.strictObject({
  kind: z.enum(["document", "frame"]),
  /**
   * The protocol session the document was read through, which is also how the
   * transport addresses it while replaying: null is the tab itself.
   */
  sessionId: z.string().nullable(),
  url: z.string().nullable(),
  /**
   * Null is a context that refused the document read, recorded rather than
   * dropped: the reader reports a gap for it, and a fixture that omitted the
   * context would replay as a page where nothing was missing.
   */
  document: DomNodeSchema.nullable(),
  ax: z.array(AxNodeSchema),
  /** The same, for a context that refused the accessibility read. */
  axFailed: z.boolean().default(false),
})

export const FixtureSchema = z.strictObject({
  kind: z.literal(FIXTURE_KIND),
  version: z.literal(FIXTURE_VERSION),
  capture: CaptureSchema,
  contexts: z.array(FixtureContextSchema).min(1),
})

export type Fixture = z.infer<typeof FixtureSchema>
export type FixtureContext = z.infer<typeof FixtureContextSchema>
export type FixtureCapture = z.infer<typeof CaptureSchema>

/**
 * Accessibility properties the reader asks for by name. Everything else in the
 * tree is structure it indexes by `backendDOMNodeId` and nothing more.
 */
const READ_AX_PROPERTIES = new Set([
  "checked",
  "disabled",
  "multiselectable",
  "readonly",
  "required",
  "selected",
])

/**
 * The DOM fields the reader ignores. `nodeId` is a frontend handle for acting
 * on a node, and this code always acts through `backendNodeId`, which a
 * recording keeps.
 */
const DOM_FIELDS_DROPPED = ["nodeId"] as const

/** Reads are by browser identity, so an AX node without one is unreachable. */
function pruneAxNode(node: AxNode): AxNode | null {
  if (node.backendDOMNodeId === undefined) return null
  const properties = node.properties?.filter((property) =>
    READ_AX_PROPERTIES.has(property.name)
  )
  return {
    nodeId: node.nodeId,
    ...(node.role ? { role: node.role } : {}),
    ...(node.name ? { name: node.name } : {}),
    ...(node.description ? { description: node.description } : {}),
    ...(node.value ? { value: node.value } : {}),
    backendDOMNodeId: node.backendDOMNodeId,
    ...(properties && properties.length > 0 ? { properties } : {}),
  }
}

export function pruneAx(nodes: AxNode[]): AxNode[] {
  const kept: AxNode[] = []
  for (const node of nodes) {
    const pruned = pruneAxNode(node)
    if (pruned) kept.push(pruned)
  }
  return kept
}

/**
 * Nodes are never dropped and `childNodeCount` is never recomputed. A parent
 * whose recorded child count exceeds the children it carries is how the reader
 * learns a subtree was cut at the depth ceiling, so a prune that tidied the two
 * apart would manufacture that signal and report a loss that never happened.
 */
export function pruneDocument(node: DomNode): DomNode {
  const pruned: DomNode = { ...node }
  for (const field of DOM_FIELDS_DROPPED) delete pruned[field]
  if (node.children) pruned.children = node.children.map(pruneDocument)
  if (node.shadowRoots) pruned.shadowRoots = node.shadowRoots.map(pruneDocument)
  if (node.contentDocument)
    pruned.contentDocument = pruneDocument(node.contentDocument)
  return pruned
}

export function pruneContext(context: {
  kind: "document" | "frame"
  sessionId: string | null
  url: string | null
  document: DomNode | null
  ax: AxNode[]
  axFailed?: boolean
}): FixtureContext {
  return {
    kind: context.kind,
    sessionId: context.sessionId,
    url: context.url,
    document:
      context.document === null ? null : pruneDocument(context.document),
    ax: pruneAx(context.ax),
    axFailed: context.axFailed ?? false,
  }
}

/** Assembles a fixture and validates it, so a bad capture fails at the source. */
export function encodeFixture(input: {
  capture: FixtureCapture
  contexts: Array<{
    kind: "document" | "frame"
    sessionId: string | null
    url: string | null
    document: DomNode | null
    ax: AxNode[]
    axFailed?: boolean
  }>
  /** Off only to compare a recording against the payload it was pruned from. */
  prune?: boolean
}): Fixture {
  const contexts =
    input.prune === false
      ? input.contexts.map((context) => ({
          ...context,
          axFailed: context.axFailed ?? false,
        }))
      : input.contexts.map(pruneContext)
  return FixtureSchema.parse({
    kind: FIXTURE_KIND,
    version: FIXTURE_VERSION,
    capture: input.capture,
    contexts,
  })
}

export type DecodeResult =
  | { ok: true; fixture: Fixture }
  | { ok: false; problem: string }

/**
 * A wrong-version fixture and a corrupt one are different failures, and a test
 * that sees the second when it meant the first learns nothing.
 */
export function decodeFixture(value: unknown): DecodeResult {
  const parsed = FixtureSchema.safeParse(value)
  if (parsed.success) return { ok: true, fixture: parsed.data }
  const version = (value as { version?: unknown } | null)?.version
  if (typeof version === "number" && version !== FIXTURE_VERSION)
    return {
      ok: false,
      problem: `fixture version ${version} was recorded for a different reader`,
    }
  const first = parsed.error.issues[0]
  const path = first?.path.join(".")
  return {
    ok: false,
    problem: path ? `${path}: ${first?.message}` : "not a fixture",
  }
}

export function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
}

/** `test/fixtures/<site>/<name>-<capture date>.json`, relative to the package. */
export function fixturePath(input: {
  site: string
  name: string
  capturedAt: string
}): string {
  const site = slug(input.site)
  const name = slug(input.name) || "page"
  const date = input.capturedAt.slice(0, 10)
  return `${site}/${name}-${date}${FIXTURE_SUFFIX}`
}
