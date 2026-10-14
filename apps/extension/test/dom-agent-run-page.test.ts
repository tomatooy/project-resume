import {
  FactSchema,
  InterpretationCache,
  SourceBundleSchema,
  type Fact,
  type SourceBundle,
} from "@workspace/resume-core/dom-agent"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createRuntimeState,
  handleDispatch,
} from "../src/dom-agent/runtime/dispatch"
import {
  RUNTIME_GLOBAL_PREFIX,
  RUNTIME_VERSION,
} from "../src/dom-agent/runtime/protocol"
import { fillCurrentPage } from "../src/dom-agent/run-page"
import {
  type PageTransport,
  attachPage,
  buildPage,
  buildPageFrom,
  createPageTransport,
} from "./helpers/cdp-page"

/**
 * The deterministic path end to end, with no model anywhere in it: a page is
 * observed, its questions enumerated, the ones a fact already matches are
 * written through the page runtime, and the run reports what the page
 * confirmed.
 *
 * The double composes the two halves a page offers: the scripted reading
 * transport, and a runtime installed in the page the way `install()` installs
 * it, once per document. A recording is data and holds no live elements, so a
 * test that writes needs a real tree; the reading half is proven against
 * recordings by the observation, question and fixture suites.
 */

const RESUME_ID = "33333333-3333-4333-8333-333333333333"
const BUNDLE_TEXT = "var VsDomAgent={};"

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

type WritingPage = {
  page: PageTransport
  /**
   * Rebuild the trees from the page as it stands now. A real page's DOM and
   * accessibility tree follow its own writes; this double builds them once, so
   * a second observation has to ask it to look again.
   */
  reread: () => void
}

/** A page that can be read through the protocol and written through the runtime. */
function writingPage(html: string): WritingPage {
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
          const call = readCall(params)
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

function fact(meaning: string, text: string): Fact {
  return FactSchema.parse({
    id: `f_${meaning.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
    meaning,
    display: text,
    value: { type: "text", text },
    scope: [],
    source: { kind: "profile", section: "contact", field: meaning },
  })
}

function bundle(facts: Fact[]): SourceBundle {
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

function fieldValue(id: string): string | undefined {
  return document.querySelector<HTMLInputElement>(`#${id}`)?.value
}

async function fill(
  html: string,
  facts: Fact[],
  options?: {
    cache?: InterpretationCache
    questionRevision?: number
    transport?: PageTransport
  }
) {
  const { session } = await attachPage({
    tabId: 11,
    runId: "run-1",
    transport: options?.transport ?? writingPage(html).page,
  })
  const result = await fillCurrentPage({
    session,
    bundle: bundle(facts),
    loadBundle: async () => BUNDLE_TEXT,
    cache: options?.cache,
    questionRevision: options?.questionRevision,
  })
  return { result, session }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe("filling a page with no model", () => {
  const FORM = `<form>
    <label for="email">Email address</label><input id="email" type="text">
    <label for="city">City</label><input id="city" type="text">
  </form>`

  it("writes what a fact already says and reports what the page confirmed", async () => {
    const { result, session } = await fill(FORM, [
      fact("email address", "ada@example.com"),
      fact("city", "Lisbon"),
    ])

    expect(result.progress).toEqual({
      accepted: 2,
      unresolved: 0,
      failed: 0,
      dispatched: 2,
    })
    expect(Object.values(result.dispositions)).toEqual(["answered", "answered"])
    expect(result.review).toEqual([])
    expect(result.state).toBe("auditing")
    expect(fieldValue("email")).toBe("ada@example.com")
    expect(fieldValue("city")).toBe("Lisbon")
    await session.detach()
  })

  it("counts only confirmed writes, never dispatched ones", async () => {
    // The application id is readonly and empty, so the reader treats it as a
    // question nobody answered and the page refuses the write on its own.
    const { result, session } = await fill(
      `<form>
        <label for="email">Email address</label><input id="email" type="text">
        <label for="app">Application id</label>
        <input id="app" type="text" readonly>
      </form>`,
      [fact("email address", "ada@example.com"), fact("application id", "4821")]
    )

    expect(result.progress.dispatched).toBe(2)
    expect(result.progress.accepted).toBe(1)
    expect(result.progress.failed).toBe(1)
    expect(fieldValue("app")).not.toBe("4821")
    expect(fieldValue("email")).toBe("ada@example.com")
    // The one that came back is still a question for the user.
    expect(result.review).toHaveLength(1)
    expect(result.review[0]?.reason).toBe("write_failed")
    expect(result.review[0]?.text).toBe("Application id")
    expect(result.state).toBe("needs_input")
    await session.detach()
  })

  it("keeps an unanswered question in the queue with the page's wording", async () => {
    const { result, session } = await fill(
      `<form>
        <label for="email">Email address</label><input id="email" type="text">
        <label for="why">Why do you want to work here?</label>
        <textarea id="why"></textarea>
      </form>`,
      [fact("email address", "ada@example.com")]
    )

    expect(result.progress.accepted).toBe(1)
    expect(result.review).toHaveLength(1)
    expect(result.review[0]?.text).toBe("Why do you want to work here?")
    expect(result.review[0]?.reason).toBe("no_matching_fact")
    expect(result.review[0]?.blocking).toBe(true)
    // Nothing was written into a field nobody had an answer for.
    expect(document.querySelector<HTMLTextAreaElement>("#why")?.value).toBe("")
    await session.detach()
  })

  it("fills a twenty-field form in one interpretation pass and reuses it", async () => {
    const fields = Array.from({ length: 20 }, (_, index) => ({
      id: `f${index}`,
      label: `Field number ${index}`,
      value: `value ${index}`,
    }))
    const html = `<form>${fields
      .map(
        (field) =>
          `<label for="${field.id}">${field.label}</label><input id="${field.id}" type="text">`
      )
      .join("")}</form>`
    const facts = fields.map((field) =>
      fact(field.label.toLowerCase(), field.value)
    )
    const cache = new InterpretationCache()

    const form = writingPage(html)
    const first = await fill(html, facts, { cache, transport: form.page })
    expect(first.result.progress.accepted).toBe(20)
    expect(first.result.interpreted.interpreted).toHaveLength(20)
    expect(first.result.interpreted.reused).toEqual([])
    for (const field of fields) expect(fieldValue(field.id)).toBe(field.value)
    await first.session.detach()

    // The same page again, as it now stands: the questions are read once, not
    // once per control.
    form.reread()
    const second = await fill(html, facts, {
      cache,
      questionRevision: 2,
      transport: form.page,
    })
    expect(second.result.interpreted.reused).toHaveLength(20)
    expect(second.result.interpreted.interpreted).toEqual([])
    expect(second.result.progress.accepted).toBe(20)
    expect(second.result.review).toEqual([])
    await second.session.detach()
  })

  it("refuses a second write at a revision the page already wrote", async () => {
    const fields = [
      { id: "email", label: "Email address", value: "ada@example.com" },
    ]
    const html = `<form><label for="email">Email address</label><input id="email" type="text"></form>`
    const facts = fields.map((field) =>
      fact(field.label.toLowerCase(), field.value)
    )
    const form = writingPage(html)

    const first = await fill(html, facts, { transport: form.page })
    expect(first.result.progress.accepted).toBe(1)
    await first.session.detach()

    // A second pass that states the same revision is a replay, and the page
    // refuses it even though the control now holds the value it was asked for.
    // Advancing the revision is the coordinator's job.
    form.reread()
    const replay = await fill(html, facts, { transport: form.page })
    expect(replay.result.progress.accepted).toBe(0)
    expect(replay.result.progress.dispatched).toBe(1)
    expect(replay.result.receipts[0]?.evidence).toContain(
      "stale_question_revision"
    )
    expect(fieldValue("email")).toBe("ada@example.com")
    await replay.session.detach()
  })
})
