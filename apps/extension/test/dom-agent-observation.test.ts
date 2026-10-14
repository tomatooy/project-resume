import { afterEach, describe, expect, it, vi } from "vitest"
import {
  observePage,
  readFragment,
  readOptions,
  readRegion,
} from "../src/dom-agent/observation"
import type { DomNode } from "../src/dom-agent/observation-payload"
import {
  attachPage,
  buildPage,
  buildPageFrom,
  createPageTransport,
} from "./helpers/cdp-page"
import { pageFromMarkup } from "./helpers/fixture-loader"

afterEach(() => vi.unstubAllGlobals())

/** Read a page the way a run does, from markup, through the fixture load path. */
async function readPage(
  html: string,
  options?: { maxBytes?: number }
): Promise<
  Awaited<ReturnType<typeof observePage>> & {
    session: Awaited<ReturnType<typeof attachPage>>["session"]
  }
> {
  // Markup goes through the recorder and the loader rather than straight into
  // the transport, so every test below proves the reader on a recorded page:
  // if the prune ever drops something the reader reads, this suite fails.
  const page = pageFromMarkup(html)
  const { session } = await attachPage({ transport: page })
  const result = await observePage({ session, ...options })
  return { ...result, session }
}

/** Controls only, which is what every assertion below is really about. */
function controls(read: Awaited<ReturnType<typeof observePage>>) {
  return read.observation.nodes.filter((node) => node.control !== null)
}

function requirednessOf(
  read: Awaited<ReturnType<typeof observePage>>,
  index: number
) {
  const control = controls(read)[index]
  if (!control) throw new Error(`No control at ${index}`)
  const evidence = read.evidence.get(control.ref)
  if (!evidence) throw new Error(`No evidence for ${control.ref}`)
  return evidence.requiredness
}

/**
 * A labelled input built as an element. The frame and shadow tests need a real
 * tree rather than a parsed string, because the reader walks elements and a
 * fixture handed to it as markup text would test the parser instead.
 */
function labelledInput(label: string, name: string): HTMLInputElement {
  const input = document.createElement("input")
  input.setAttribute("name", name)
  input.setAttribute("aria-label", label)
  return input
}

describe("joining the two trees", () => {
  it("joins by browser identity, so two controls with one name stay two", async () => {
    const read = await readPage(
      `<form><input aria-label="Email" name="primary"><input aria-label="Email" name="secondary"></form>`
    )
    const found = controls(read)
    expect(found).toHaveLength(2)
    expect(found[0]?.name).toBe("Email")
    expect(found[1]?.name).toBe("Email")
    // The name is never the identity: the references resolve to different nodes.
    expect(found[0]?.ref).not.toBe(found[1]?.ref)
    const first = read.index.resolve(found[0]?.ref ?? "")
    const second = read.index.resolve(found[1]?.ref ?? "")
    expect(first?.backendNodeId).not.toBe(second?.backendNodeId)
    await read.session.detach()
  })

  it("keeps a control with no wording instead of dropping it", async () => {
    const read = await readPage(`<input type="text" name="mystery">`)
    const found = controls(read)
    expect(found).toHaveLength(1)
    expect(found[0]?.name).toBeNull()
    expect(found[0]?.text).toBeNull()
    await read.session.detach()
  })

  it("carries the original wording beside the computed name", async () => {
    const read = await readPage(
      `<label for="city">City <span>*</span></label><input id="city" name="city">`
    )
    const control = controls(read)[0]
    expect(control?.name).toBe("City *")
    expect(control?.text).toBe("City *")
    expect(read.evidence.get(control?.ref ?? "")?.labelText).toBe("City *")
    await read.session.detach()
  })
})

describe("requiredness and its evidence", () => {
  it("reads a native attribute as evidence", async () => {
    const read = await readPage(`<input name="a" required>`)
    expect(requirednessOf(read, 0)).toEqual({
      state: "required",
      evidence: ["native_attribute"],
    })
    await read.session.detach()
  })

  it("reads an ARIA declaration as evidence", async () => {
    const read = await readPage(`<input name="a" aria-required="true">`)
    expect(requirednessOf(read, 0).evidence).toContain("aria_attribute")
    await read.session.detach()
  })

  it("treats a visible marker as evidence", async () => {
    const read = await readPage(
      `<label for="a">Phone *</label><input id="a" name="a">`
    )
    expect(requirednessOf(read, 0)).toEqual({
      state: "required",
      evidence: ["visible_marker"],
    })
    await read.session.detach()
  })

  it("never infers optionality from an absent attribute", async () => {
    const read = await readPage(
      `<label for="a">Website</label><input id="a" name="a">`
    )
    expect(requirednessOf(read, 0)).toEqual({ state: "unknown", evidence: [] })
    await read.session.detach()
  })

  it("accepts an explicit declaration of optionality", async () => {
    const explicit = await readPage(`<input name="a" aria-required="false">`)
    expect(requirednessOf(explicit, 0)).toEqual({
      state: "optional",
      evidence: ["aria_attribute"],
    })
    await explicit.session.detach()

    const stated = await readPage(
      `<label for="a">Cover letter (optional)</label><input id="a" name="a">`
    )
    expect(requirednessOf(stated, 0)).toEqual({
      state: "optional",
      evidence: ["instruction_text"],
    })
    await stated.session.detach()
  })

  it("reads an instruction as evidence", async () => {
    const read = await readPage(
      `<div id="hint">This field is required.</div><input name="a" aria-describedby="hint">`
    )
    expect(requirednessOf(read, 0).evidence).toContain("instruction_text")
    await read.session.detach()
  })
})

describe("grouped controls", () => {
  it("turns a radio set into one question with its options", async () => {
    const read = await readPage(
      `<fieldset><legend>Gender</legend>
        <input type="radio" name="gender" value="m" aria-label="Male" required>
        <input type="radio" name="gender" value="f" aria-label="Female">
      </fieldset>`
    )
    const found = controls(read)
    expect(found).toHaveLength(1)
    expect(found[0]?.control?.kind).toBe("radio_group")
    expect(found[0]?.control?.options.map((option) => option.label)).toEqual([
      "Male",
      "Female",
    ])
    // The legend is the question, not the first option's label.
    expect(read.evidence.get(found[0]?.ref ?? "")?.labelText).toBe("Gender")
    expect(requirednessOf(read, 0).evidence).toContain("group_requirement")
    await read.session.detach()
  })

  it("keeps a lone checkbox as its own question", async () => {
    const read = await readPage(
      `<label><input type="checkbox" name="remote"> Remote</label>`
    )
    const found = controls(read)
    expect(found).toHaveLength(1)
    expect(found[0]?.control?.kind).toBe("checkbox")
    await read.session.detach()
  })

  it("treats a repeated checkbox name as one multi-choice question", async () => {
    const read = await readPage(
      `<fieldset><legend>Stack</legend>
        <label><input type="checkbox" name="stack" value="ts">TypeScript</label>
        <label><input type="checkbox" name="stack" value="go">Go</label>
      </fieldset>`
    )
    const found = controls(read)
    expect(found).toHaveLength(1)
    expect(found[0]?.control?.kind).toBe("checkbox_group")
    expect(found[0]?.control?.options).toHaveLength(2)
    await read.session.detach()
  })
})

describe("button choices", () => {
  it("reads a pair of toggle buttons and the field they submit as one question", async () => {
    const read = await readPage(
      `<div>
        <label for="work">Are you legally authorized to work in the United States?</label>
        <div>
          <button aria-pressed="false" data-option="yes">Yes</button>
          <button aria-pressed="false" data-option="no">No</button>
          <input type="checkbox" tabindex="-1" name="work" style="display:none">
        </div>
      </div>`
    )
    const found = controls(read)
    // One question, not three: the two buttons are its options and the hidden
    // checkbox is the field it submits through, not a control of its own.
    expect(found).toHaveLength(1)
    expect(found[0]?.control?.kind).toBe("button_choice")
    expect(found[0]?.control?.options.map((option) => option.label)).toEqual([
      "Yes",
      "No",
    ])
    // The label the page authored for the field is the question, not the option
    // text: answering "Yes" when the page asked about work authorization would
    // be answering the wrong question.
    expect(read.evidence.get(found[0]?.ref ?? "")?.labelText).toBe(
      "Are you legally authorized to work in the United States?"
    )
    await read.session.detach()
  })

  it("reads role=radio members of a declared radiogroup as one question", async () => {
    const read = await readPage(
      `<div role="radiogroup" aria-label="Plan">
        <div role="radio" aria-checked="false">Free</div>
        <div role="radio" aria-checked="false">Pro</div>
      </div>`
    )
    const found = controls(read)
    expect(found).toHaveLength(1)
    expect(found[0]?.control?.kind).toBe("button_choice")
    expect(found[0]?.control?.options.map((option) => option.label)).toEqual([
      "Free",
      "Pro",
    ])
    expect(read.evidence.get(found[0]?.ref ?? "")?.labelText).toBe("Plan")
    await read.session.detach()
  })

  it("never reads a button that submits or navigates as a choice", async () => {
    const read = await readPage(
      `<form><input name="a" aria-label="A">
        <button>Submit application</button>
        <a href="#next" role="button">Next</a>
      </form>`
    )
    // Neither carries the state a choice is read from, so neither is one, and
    // the engine never has to click something to find out what it does.
    expect(controls(read).map((control) => control.control?.kind)).toEqual([
      "text",
    ])
    await read.session.detach()
  })

  it("leaves a lone toggle button alone", async () => {
    const read = await readPage(`<button aria-pressed="false">Mute</button>`)
    // One toggle is a control the page owns. Two together, under one field, is
    // the evidence that the page is asking a question.
    expect(controls(read)).toHaveLength(0)
    await read.session.detach()
  })

  it("keeps the option list another control names out of the question list", async () => {
    const read = await readPage(
      `<div role="combobox" aria-label="Country" aria-controls="list" aria-expanded="false"></div>
       <div id="list">
         <button aria-pressed="false">Portugal</button>
         <button aria-pressed="false">Spain</button>
       </div>`
    )
    // The list belongs to the control, so its buttons are its options and never
    // a question of their own.
    expect(controls(read).map((control) => control.control?.kind)).toEqual([
      "combobox",
    ])
    await read.session.detach()
  })
})

describe("coverage gaps", () => {
  it("refuses to read at all without accessibility semantics", async () => {
    const page = createPageTransport()
    page.setDocument(null, buildPage(`<input name="a">`))
    page.fail("Accessibility.getFullAXTree", "Not supported")
    const { session } = await attachPage({ transport: page })
    const read = await observePage({ session })

    expect(session.capability.accessibility).toBe(false)
    expect(read.observation.coverage.complete).toBe(false)
    expect(read.observation.nodes).toHaveLength(0)
    expect(read.observation.coverage.gaps[0]?.reason).toBe("unsupported")
    expect(read.observation.coverage.gaps[0]?.detail).toMatch(/unavailable/)
    await session.detach()
  })

  it("records an accessibility tree that fails mid-read", async () => {
    const page = createPageTransport()
    page.setDocument(null, buildPage(`<input name="a" aria-label="Name">`))
    const { session } = await attachPage({ transport: page })
    page.fail("Accessibility.getFullAXTree", "Domain unavailable")
    const read = await observePage({ session })

    expect(read.observation.coverage.complete).toBe(false)
    expect(read.observation.coverage.gaps[0]?.reason).toBe("unsupported")
    // The DOM-observed control is still there: an AX omission is not an erasure.
    expect(controls(read)).toHaveLength(1)
    await session.detach()
  })

  it("excludes authentication fields and counts them", async () => {
    const read = await readPage(
      `<form><input type="password" name="password"><input name="card_number">
        <input name="email" aria-label="Email"></form>`
    )
    expect(controls(read)).toHaveLength(1)
    const gap = read.observation.coverage.gaps.find((candidate) =>
      candidate.scope.includes("authentication")
    )
    expect(gap?.reason).toBe("unsupported")
    expect(gap?.detail).toMatch(/2 field/)
    await read.session.detach()
  })

  it("excludes our own widget without calling it a gap", async () => {
    const read = await readPage(
      `<body><div data-vs-autofill="true"><input aria-label="Panel field"></div>
        <input name="real" aria-label="Real field"></body>`
    )
    expect(controls(read).map((control) => control.name)).toEqual([
      "Real field",
    ])
    expect(read.observation.coverage.gaps).toHaveLength(0)
    await read.session.detach()
  })

  it("records a closed shadow root it cannot reach", async () => {
    const built = buildPage(`<div id="host"></div>`)
    const hostNode = built.dom.children?.[0]
    if (!hostNode) throw new Error("fixture missing host")
    const secret: DomNode = {
      backendNodeId: 9001,
      nodeType: 1,
      nodeName: "INPUT",
      attributes: ["aria-label", "Secret"],
    }
    hostNode.shadowRoots = [
      {
        backendNodeId: 9000,
        nodeType: 11,
        nodeName: "#document-fragment",
        shadowRootType: "closed",
        childNodeCount: 1,
        children: [secret],
      },
    ]
    const page = createPageTransport()
    page.setDocument(null, built)
    const { session } = await attachPage({ transport: page })
    const read = await observePage({ session })

    expect(read.observation.coverage.complete).toBe(false)
    expect(
      read.observation.coverage.gaps.some(
        (gap) => gap.reason === "closed_shadow"
      )
    ).toBe(true)
    await session.detach()
  })

  it("ignores a closed shadow root that only holds our widget", async () => {
    const built = buildPage(`<div id="host"></div>`)
    const hostNode = built.dom.children?.[0]
    if (!hostNode) throw new Error("fixture missing host")
    hostNode.shadowRoots = [
      {
        backendNodeId: 9000,
        nodeType: 11,
        nodeName: "#document-fragment",
        shadowRootType: "closed",
        childNodeCount: 1,
        children: [
          {
            backendNodeId: 9001,
            nodeType: 1,
            nodeName: "IFRAME",
            attributes: ["src", "chrome-extension://abcdefghijk/widget.html"],
          },
        ],
      },
    ]
    const page = createPageTransport()
    page.setDocument(null, built)
    const { session } = await attachPage({ transport: page })
    const read = await observePage({ session })

    expect(read.observation.coverage.gaps).toHaveLength(0)
    expect(read.observation.coverage.complete).toBe(true)
    await session.detach()
  })

  it("records a subtree the browser returned truncated", async () => {
    const built = buildPage(`<form><input name="a" aria-label="A"></form>`)
    const form = built.dom.children?.[0]
    if (!form) throw new Error("fixture missing form")
    form.childNodeCount = 9
    form.children = []
    const page = createPageTransport()
    page.setDocument(null, built)
    const { session } = await attachPage({ transport: page })
    const read = await observePage({ session })

    expect(
      read.observation.coverage.gaps.some((gap) => gap.reason === "truncated")
    ).toBe(true)
    expect(read.observation.coverage.complete).toBe(false)
    await session.detach()
  })

  it("drops a read that a page change overtook, and says the page was not read", async () => {
    const page = createPageTransport()
    page.setDocument(null, buildPage(`<input name="a" aria-label="A">`))
    const { session, harness } = await attachPage({ transport: page })
    // The document is replaced while the read is in flight. The session bumps
    // its generation, so the result belongs to a page that no longer exists.
    const original = page.transport.send.bind(page.transport)
    let fired = false
    page.transport.send = async (sessionId, method, params) => {
      const result = await original(sessionId, method, params)
      if (!fired && method === "DOM.getDocument") {
        fired = true
        harness.emit("DOM.documentUpdated")
      }
      return result
    }
    const read = await observePage({ session })

    expect(read.observation.coverage.complete).toBe(false)
    expect(read.observation.nodes).toHaveLength(0)
    expect(read.observation.coverage.gaps.length).toBeGreaterThan(0)
    await session.detach()
  })

  it("records an unreadable frame session as a cross-origin gap", async () => {
    const page = createPageTransport()
    page.setDocument(
      null,
      buildPage(`<div><input name="a" aria-label="A"></div>`)
    )
    // An out-of-process frame is its own protocol session, and this one refuses.
    page.fail("DOM.getDocument", "Cross origin", "child-1")
    const { session, harness } = await attachPage({ transport: page })
    harness.emit(
      "Target.attachedToTarget",
      {
        sessionId: "child-1",
        targetInfo: { targetId: "t1", url: "https://other.example/frame" },
      },
      "child-1"
    )
    const read = await observePage({ session })

    expect(read.observation.coverage.complete).toBe(false)
    expect(
      read.observation.coverage.gaps.some(
        (gap) => gap.reason === "cross_origin"
      )
    ).toBe(true)
    // The rest of the page is still read: one unreadable frame is not a
    // reason to abandon the application form.
    expect(controls(read).map((control) => control.name)).toEqual(["A"])
    await session.detach()
  })
})

describe("contexts", () => {
  it("reads a frame through its own context", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const wrapper = document.createElement("div")
    wrapper.appendChild(labelledInput("Outer", "outer"))
    const frame = document.createElement("iframe")
    frame.id = "inner"
    container.append(wrapper, frame)
    if (!frame.contentDocument) throw new Error("jsdom gave no frame document")
    frame.contentDocument.body.appendChild(labelledInput("Inner", "inner"))

    const page = createPageTransport()
    page.setDocument(null, buildPageFrom(container))
    const { session } = await attachPage({ transport: page })
    const read = await observePage({ session })

    const outer = controls(read).find((control) => control.name === "Outer")
    const inner = controls(read).find((control) => control.name === "Inner")
    expect(outer?.contextId).toBe("root")
    expect(inner?.contextId).toMatch(/^frame:/)
    expect(outer?.contextId).not.toBe(inner?.contextId)
    expect(
      read.observation.contexts.map((context) => context.kind).sort()
    ).toEqual(["document", "frame"])
    await session.detach()
    container.remove()
  })

  it("reads an open shadow root through its own context", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const wrapper = document.createElement("div")
    wrapper.appendChild(labelledInput("Outer", "outer"))
    const host = document.createElement("div")
    host.id = "widget"
    container.append(wrapper, host)
    const shadow = host.attachShadow({ mode: "open" })
    shadow.appendChild(labelledInput("Shadowed", "shadowed"))

    const page = createPageTransport()
    page.setDocument(null, buildPageFrom(container))
    const { session } = await attachPage({ transport: page })
    const read = await observePage({ session })

    const outer = controls(read).find((control) => control.name === "Outer")
    const shadowed = controls(read).find(
      (control) => control.name === "Shadowed"
    )
    expect(outer?.contextId).toBe("root")
    expect(shadowed?.contextId).toMatch(/^shadow:/)
    expect(read.observation.contexts.map((context) => context.kind)).toContain(
      "shadow_root"
    )
    await session.detach()
    container.remove()
  })
})

describe("budgets", () => {
  it("stays inside the node ceiling and says what it dropped", async () => {
    const inputs = Array.from(
      { length: 1100 },
      (_, index) => `<input name="f${index}" aria-label="Field ${index}">`
    ).join("")
    const read = await readPage(`<form>${inputs}</form>`)

    expect(read.observation.nodes.length).toBeLessThanOrEqual(1000)
    expect(read.observation.coverage.complete).toBe(false)
    expect(
      read.observation.coverage.gaps.some((gap) => gap.reason === "budget")
    ).toBe(true)
    await read.session.detach()
  })

  it("trims to a byte ceiling and never claims to be complete", async () => {
    const fields = Array.from(
      { length: 40 },
      (_, index) =>
        `<label for="f${index}">An extremely long field label number ${index} that exists only to consume the byte budget</label><input id="f${index}" name="f${index}">`
    ).join("")
    const read = await readPage(`<form>${fields}</form>`, { maxBytes: 2000 })

    expect(read.observation.coverage.complete).toBe(false)
    expect(
      read.observation.coverage.gaps.some((gap) => gap.reason === "budget")
    ).toBe(true)
    expect(
      new TextEncoder().encode(JSON.stringify(read.observation)).length
    ).toBeLessThanOrEqual(2000)
    await read.session.detach()
  })

  it("asks the browser for a bounded document, not the whole tree", async () => {
    const page = createPageTransport()
    page.setDocument(null, buildPage(`<input name="a" aria-label="A">`))
    const { session } = await attachPage({ transport: page })
    const read = await observePage({ session })

    // The first read is bounded by the same depth the plan uses, so a deeply
    // nested page cannot cost an unbounded fetch. The session's own probe also
    // reads the document, which is why this is about every request rather than
    // about one of them.
    const requested = page.commands.filter(
      (command) => command.method === "DOM.getDocument"
    )
    expect(requested.some((command) => command.params.depth === 40)).toBe(true)
    for (const command of requested) expect(command.params.depth).not.toBe(-1)
    // Nothing was cut on a page this shallow, so it is still complete.
    expect(read.observation.coverage.complete).toBe(true)
    await session.detach()
  })

  it("records a subtree cut at the depth ceiling instead of calling the page complete", async () => {
    const deep =
      "<div>".repeat(45) +
      `<input name="deep" aria-label="Deep">` +
      "</div>".repeat(45)
    // This one test reads a payload the browser did not cut, because the reader's
    // own ceiling is only reachable while the tree still has levels past it. A
    // recording is cut the way the browser cuts it, which is the other path, and
    // `dom-agent-fixtures.test.ts` covers that one.
    const page = createPageTransport()
    page.setDocument(null, buildPage(deep))
    const { session } = await attachPage({ transport: page })
    const read = await observePage({ session })

    // The control really is missing from the read, so the gap is about a loss
    // rather than a log line.
    expect(controls(read).some((control) => control.name === "Deep")).toBe(
      false
    )
    // And the observation says the page was not fully read.
    expect(read.observation.coverage.complete).toBe(false)
    const gap = read.observation.coverage.gaps.find((candidate) =>
      candidate.detail.includes("deeper than 40")
    )
    expect(gap?.reason).toBe("truncated")
    await session.detach()
  })

  it("records a cut on a node planning drops, not only on the ones it keeps", async () => {
    const built = buildPage(`<div id="cut"></div>`)
    const cut = built.dom.children?.[0]
    if (!cut) throw new Error("fixture missing the cut node")
    // A bounded read cuts at its depth, so a boundary node arrives declaring
    // children it did not return. This one holds no control, no region and no
    // text of its own, so planning drops it and `emit` never sees it: the count
    // is the only evidence of what was lost, and it has to be read on the way
    // past. A cut recording in `dom-agent-fixtures.test.ts` is the same shape.
    cut.childNodeCount = 3
    cut.children = []
    const page = createPageTransport()
    page.setDocument(null, built)
    const { session } = await attachPage({ transport: page })
    const read = await observePage({ session })

    expect(read.observation.coverage.complete).toBe(false)
    const gap = read.observation.coverage.gaps.find((candidate) =>
      candidate.detail.includes("fewer children")
    )
    expect(gap?.reason).toBe("truncated")
    await session.detach()
  })

  it("does not report a cut when every child the node declares came back", async () => {
    // The same dropped shape with nothing cut under it. The count matches, so
    // there is no loss to report and the page is still complete: a gap here
    // would make every page with a wrapper element look unreadable.
    const read = await readPage(`<div><span>nothing to read here</span></div>`)
    expect(read.observation.coverage.gaps).toHaveLength(0)
    expect(read.observation.coverage.complete).toBe(true)
    await read.session.detach()
  })

  it("reads the same page the same way twice", async () => {
    const html = `<form><label for="a">Name</label><input id="a" name="a">
      <label for="b">Email</label><input id="b" name="b"></form>`
    const first = await readPage(html)
    const second = await readPage(html)

    expect(second.observation.nodes.length).toBe(first.observation.nodes.length)
    expect(controls(second).map((control) => control.name)).toEqual(
      controls(first).map((control) => control.name)
    )
    expect(controls(second).map((control) => control.control?.kind)).toEqual(
      controls(first).map((control) => control.control?.kind)
    )
    await first.session.detach()
    await second.session.detach()
  })
})

describe("reads on request", () => {
  it("reads a region by its own reference, and says when it cannot", async () => {
    const page = createPageTransport()
    page.setDocument(
      null,
      buildPage(
        `<form><fieldset><legend>Contact</legend><label for="a">Name</label><input id="a" name="a"></fieldset></form>`
      )
    )
    const { session } = await attachPage({ transport: page })
    const read = await observePage({ session })

    const region = read.observation.regions.find(
      (candidate) => candidate.nodeRefs.length > 0
    )
    if (!region) throw new Error("fixture missing region")
    const anchor = region.nodeRefs[0]
    if (!anchor) throw new Error("fixture missing region anchor")
    const identity = read.index.resolve(anchor)
    if (!identity) throw new Error("fixture missing region identity")

    const inner = buildPage(`<div><input name="deep" aria-label="Deep"></div>`)
    page.setDescribe(identity.backendNodeId, inner.dom)
    const fragment = await readRegion({ session, read, regionRef: region.ref })

    // A region read is a fragment of its own: bounded, with its own coverage,
    // and never pretending to be the page it came from.
    expect(fragment.nodes.length).toBeGreaterThan(0)
    expect(fragment.nodes.map((node) => node.ref)).not.toContain(anchor)
    expect(fragment.coverage.complete).toBe(true)

    // A region that is no longer part of this observation is refused, not read
    // from a guess about where it went.
    const missing = await readRegion({ session, read, regionRef: "n999" })
    expect(missing.nodes).toHaveLength(0)
    expect(missing.coverage.complete).toBe(false)
    await session.detach()
  })

  it("reads a bounded fragment by browser identity", async () => {
    const page = createPageTransport()
    page.setDocument(
      null,
      buildPage(`<div><label for="a">Name</label><input id="a" name="a"></div>`)
    )
    const { session } = await attachPage({ transport: page })
    const read = await observePage({ session })
    const control = controls(read)[0]
    if (!control) throw new Error("fixture missing control")
    const identity = read.index.resolve(control.ref)
    if (!identity) throw new Error("fixture missing identity")

    const inner = buildPage(`<input name="detail" aria-label="Deeper detail">`)
    page.setDescribe(identity.backendNodeId, inner.dom)
    const fragment = await readFragment({ session, read, nodeRef: control.ref })

    expect(fragment.coverage.complete).toBe(true)
    expect(fragment.nodes.length).toBeGreaterThan(0)
    expect(fragment.nodes[0]?.ref).not.toBe(control.ref)
    await session.detach()
  })

  it("refuses a fragment that is no longer in the observation", async () => {
    const read = await readPage(`<input name="a" aria-label="A">`)
    const fragment = await readFragment({
      session: read.session,
      read,
      nodeRef: "n999",
    })
    expect(fragment.coverage.complete).toBe(false)
    expect(fragment.nodes).toHaveLength(0)
    await read.session.detach()
  })

  it("reads an option portal named by the control", async () => {
    const read = await readPage(
      `<input role="combobox" aria-controls="portal" aria-label="Country" aria-haspopup="listbox">
       <div id="portal" role="listbox">
         <div role="option" aria-selected="true">Portugal</div>
         <div role="option">Spain</div>
       </div>`
    )
    const control = controls(read)[0]
    if (!control) throw new Error("fixture missing control")
    const portal = await readOptions({
      session: read.session,
      read,
      controlRef: control.ref,
    })

    expect(portal.gap).toBeNull()
    expect(portal.options.map((option) => option.label)).toEqual([
      "Portugal",
      "Spain",
    ])
    expect(portal.options[0]?.selected).toBe(true)
    await read.session.detach()
  })

  it("reports an option list that is not mounted yet", async () => {
    const read = await readPage(
      `<input role="combobox" aria-controls="portal" aria-label="Country" aria-haspopup="listbox">`
    )
    const control = controls(read)[0]
    if (!control) throw new Error("fixture missing control")
    const portal = await readOptions({
      session: read.session,
      read,
      controlRef: control.ref,
    })

    expect(portal.options).toEqual([])
    expect(portal.gap?.detail).toMatch(/not mounted|not present|does not name/)
    await read.session.detach()
  })
})

describe("the control that adds a group", () => {
  const JOBS = `<div id="jobs">
    <div class="job"><label for="e1">Employer name</label><input id="e1" value="Acme"></div>
    <div class="job"><label for="e2">Employer name</label><input id="e2" value="Globex"></div>
  </div>`

  it("names the control a repeated container offers for growing itself", async () => {
    const read = await readPage(
      `<form>${JOBS}<button type="button" aria-controls="jobs">Add another experience</button></form>`
    )

    const found = [...read.groupAddControls.entries()]
    expect(found).toHaveLength(2)
    const [groupRef, addRef] = found[0] ?? []
    // The group carries the control that grows the container it sits in, and
    // that control is the page's own wording rather than a guess from position.
    expect(groupRef).toMatch(/^r\d+$/)
    const button = read.observation.nodes.find((node) => node.ref === addRef)
    expect(button?.tag).toBe("button")
    expect(button?.name).toMatch(/add another experience/i)
    // It is kept as a node so it can be pressed, and it is not a question: a
    // bare button states no value, so nothing here becomes something to answer.
    expect(button?.control).toBeNull()
    // One container, so every group in it is grown by the same control.
    expect(found[1]?.[1]).toBe(addRef)
    await read.session.detach()
  })

  it("leaves a button the page does not word as adding out of it", async () => {
    const read = await readPage(
      `<form>${JOBS}<button type="button">Remove this job</button></form>`
    )
    // Nothing names a control, so nothing can be pressed: the run reports the
    // record it could not place rather than activating a control it misread.
    expect([...read.groupAddControls.entries()]).toEqual([])
    await read.session.detach()
  })

  it("reads a control the container holds, with nothing declared", async () => {
    // The other half of the page's statement: the control sits inside the
    // container it grows, and no `aria-controls` says so. Nearest ancestor wins,
    // so a control rendered inside the list is that list's control.
    const read = await readPage(
      `<form><div id="jobs">
        <div class="job"><label for="e1">Employer name</label><input id="e1" value="Acme"></div>
        <div class="job"><label for="e2">Employer name</label><input id="e2" value="Globex"></div>
        <button type="button">Add another experience</button>
      </div></form>`
    )

    const found = [...read.groupAddControls.entries()]
    expect(found).toHaveLength(2)
    const button = read.observation.nodes.find(
      (node) => node.ref === found[0]?.[1]
    )
    expect(button?.tag).toBe("button")
    expect(found[1]?.[1]).toBe(found[0]?.[1])
    await read.session.detach()
  })

  it("ignores an add button that grows something else", async () => {
    const read = await readPage(
      `<form>${JOBS}<button type="button">Add another reference</button></form>`
    )
    // The label matches, and the button is outside the container it would have
    // to grow, so it is not this container's control.
    expect([...read.groupAddControls.entries()]).toEqual([])
    await read.session.detach()
  })
})
