import {
  FactSchema,
  SourceBundleSchema,
  type Fact,
  type SourceBundle,
} from "@workspace/resume-core/dom-agent"
import {
  createRuntimeState,
  handleDispatch,
} from "../../src/dom-agent/runtime/dispatch"
import {
  RUNTIME_GLOBAL_PREFIX,
  RUNTIME_VERSION,
} from "../../src/dom-agent/runtime/protocol"
import {
  type PageTransport,
  buildPage,
  buildPageFrom,
  createPageTransport,
} from "./cdp-page"

/**
 * A page that can be read through the protocol and written through the runtime,
 * which is what any run test needs and no recording can give: a recording holds
 * data, not live elements, so the writing half has to be a real tree.
 *
 * Shared rather than copied per suite. Three suites building their own doubles
 * is three places for the write path to drift from what the runtime actually
 * does, and the drift would show up as a green test over a page nothing writes
 * to.
 */

export const RESUME_ID = "33333333-3333-4333-8333-333333333333"
export const BUNDLE_TEXT = "var VsDomAgent={};"

const globalSlots = globalThis as unknown as Record<string, unknown>
let installs = 0

/** One install per document, as the page's own `install()` guarantees. */
function installOnce(): {
  version: number
  nonce: string
  key: string
} {
  installs += 1
  const key = `${RUNTIME_GLOBAL_PREFIX}_test${installs}`
  const state = createRuntimeState()
  type DispatchArgs = [unknown, unknown, unknown, unknown, unknown, unknown]
  globalSlots[key] = function (
    this: unknown,
    ...[actionRef, questionRef, verb, step, expect, version]: DispatchArgs
  ) {
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
  return { version: RUNTIME_VERSION, nonce: `test${installs}`, key }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readCall(params: Record<string, unknown> | undefined): {
  objectId: string
  values: unknown[]
} {
  const objectId = params?.objectId
  const args = params?.arguments
  if (typeof objectId !== "string") throw new Error("No call target")
  if (!Array.isArray(args)) throw new Error("No arguments")
  const values: unknown[] = []
  for (const argument of args) {
    if (!isRecord(argument)) throw new Error("Argument is not a value")
    values.push(argument.value)
  }
  return { objectId, values }
}

export type WritingPage = {
  page: PageTransport
  /**
   * Rebuild the trees from the page as it stands now. A real page's DOM and
   * accessibility tree follow its own writes; this double builds them once, so
   * a second observation has to ask it to look again.
   */
  reread: () => void
}

/** A page that can be read through the protocol and written through the runtime. */
export function writingPage(html: string): WritingPage {
  const base = createPageTransport()
  let built = buildPage(html)
  // The helper builds its tree on a detached host, and the page refuses to
  // write to a control that is not connected, so the tree is attached here.
  // A write test against a detached tree would prove nothing.
  const rootId = built.dom.backendNodeId
  const root = rootId === undefined ? undefined : built.elements.get(rootId)
  if (root) document.body.appendChild(root as Element)
  base.setDocument(null, built)
  const installation = installOnce()
  const objects = new Map<string, Element>()

  const page: PageTransport = {
    ...base,
    commands: base.commands,
    transport: {
      async send(sessionId, method, params) {
        if (method === "Runtime.evaluate")
          return { result: { value: installation } }
        if (method === "DOM.resolveNode") {
          const element = built.elements.get(Number(params?.backendNodeId))
          if (!element) throw new Error("No such node")
          const objectId = `node-${String(params?.backendNodeId)}`
          objects.set(objectId, element as Element)
          return { object: { objectId } }
        }
        if (method === "Runtime.callFunctionOn") {
          const call = readCall(params as Record<string, unknown> | undefined)
          const element = objects.get(call.objectId)
          if (!element) throw new Error("No such object")
          const runtime = globalSlots[String(call.values[0])]
          if (typeof runtime !== "function") throw new Error("Not installed")
          const bound = runtime as (...args: unknown[]) => Promise<unknown>
          return {
            result: {
              value: await bound.call(element, ...call.values.slice(1)),
            },
          }
        }
        if (method === "Runtime.releaseObject") return {}
        return base.transport.send(sessionId, method, params)
      },
    },
  }

  return {
    page,
    reread: () => {
      if (!root) return
      built = buildPageFrom(root)
      base.setDocument(null, built)
    },
  }
}

/**
 * A fact whose meaning is the wording a question has to carry to be answered
 * without a model. The default value is the display text, which is what a plain
 * field needs; a choice, boolean, number, date or money field states its own.
 */
export function fact(
  meaning: string,
  display: string,
  value: Fact["value"] = { type: "text", text: display }
): Fact {
  return FactSchema.parse({
    id: `f_${meaning.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
    meaning,
    display,
    value,
    scope: [],
    source: { kind: "profile", section: "contact", field: meaning },
  })
}

export function bundle(facts: Fact[]): SourceBundle {
  return SourceBundleSchema.parse({
    id: "bundle-1",
    resumeId: RESUME_ID,
    resumeVersionId: null,
    sources: [
      { kind: "resume", id: RESUME_ID, revision: 1, contentHash: "hash-1" },
    ],
    facts,
    render: {
      templateId: "lisbon",
      templateOptions: { pageSize: "LETTER", fontScale: 1 },
      locale: null,
      renderVersion: "1",
    },
  })
}
