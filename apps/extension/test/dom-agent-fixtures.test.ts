import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { observePage } from "../src/dom-agent/observation"
import type { AxNode, DomNode } from "../src/dom-agent/observation-payload"
import { capturePage } from "../tools/capture-page"
import {
  createCdpConnection,
  pickPageTarget,
  type CdpConnection,
  type CdpSocket,
  type CdpTarget,
} from "../tools/cdp-client"
import {
  FIXTURES_RELATIVE,
  decodeFixture,
  fixturePath,
  pruneAx,
  pruneDocument,
  slug,
} from "../tools/fixture-format"
import {
  attachPage,
  buildPage,
  buildPageFrom,
  type BuiltPage,
} from "./helpers/cdp-page"
import {
  FIXTURES_DIR,
  emitRecordedFrames,
  listFixtures,
  loadFixture,
  pageFromFixture,
  pageFromMarkup,
  recordPage,
  truncateDocument,
} from "./helpers/fixture-loader"

/**
 * A page with the shapes a real application page has: labelled controls,
 * constraints, a described field, grouped choices, a select, a file input, a
 * comment, and a shadow root.
 */
const RICH_PAGE = `
  <!-- the reader sees comments as nodes, and the child counts depend on them -->
  <form aria-label="Application">
    <fieldset>
      <legend>Contact</legend>
      <label for="name">Full name</label>
      <input id="name" name="name" required maxlength="80">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" aria-describedby="email-note">
      <p id="email-note">We use this to reach you.</p>
      <label for="start">Available from</label>
      <input id="start" name="start" type="month">
    </fieldset>
    <fieldset>
      <legend>Eligibility</legend>
      <label><input type="checkbox" name="auth" checked> Authorized to work</label>
      <label for="why">Why this role</label>
      <textarea id="why" name="why" rows="3"></textarea>
      <label for="resume">Resume</label>
      <input id="resume" type="file" accept=".pdf,.docx">
      <label for="level">Level</label>
      <select id="level" name="level">
        <option value="">Choose</option>
        <option value="mid">Mid</option>
        <option value="senior" selected>Senior</option>
      </select>
    </fieldset>
    <fieldset>
      <legend>Shift</legend>
      <label><input type="radio" name="shift" value="day" checked> Day</label>
      <label><input type="radio" name="shift" value="night"> Night</label>
    </fieldset>
  </form>
`

const FRAME_PAGE = `
  <form>
    <label for="cover">Cover letter</label>
    <textarea id="cover" name="cover"></textarea>
  </form>
`

/** A host with an open shadow root, which a recording keeps like any subtree. */
function shadowPage(): BuiltPage {
  const host = document.createElement("div")
  const shadow = host.attachShadow({ mode: "open" })
  const label = document.createElement("label")
  label.setAttribute("for", "s")
  label.textContent = "Shadow field"
  const input = document.createElement("input")
  input.setAttribute("id", "s")
  input.setAttribute("name", "s")
  shadow.append(label, input)
  return buildPageFrom(host)
}

/** An AX node as Chrome reports one, scaffolding and all. */
function chromeAx(node: AxNode): AxNode {
  return {
    ...node,
    ignored: false,
    parentId: "ax0",
    childIds: [],
    properties: [
      ...(node.properties ?? []),
      { name: "focusable", value: { type: "boolean", value: true } },
      { name: "live", value: { type: "string", value: "polite" } },
    ],
  }
}

function chromeLikeAx(page: BuiltPage): BuiltPage {
  return { ...page, ax: page.ax.map(chromeAx) }
}

async function observeFixture(fixture: Parameters<typeof pageFromFixture>[0]) {
  const { session, harness } = await attachPage({
    transport: pageFromFixture(fixture),
  })
  emitRecordedFrames(harness, fixture)
  const read = await observePage({ session, id: "obs-recording" })
  await session.detach()
  return read
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the recorded shape", () => {
  it("keeps what the reader reads and drops the handles it never touches", () => {
    const built = chromeLikeAx(buildPage(RICH_PAGE))
    const pruned = pruneDocument(built.dom)

    // A frontend handle is for acting on a node; this reader acts through the
    // browser id, which a recording keeps.
    const withHandle: DomNode = {
      nodeType: 1,
      nodeName: "DIV",
      nodeId: 42,
      backendNodeId: 7,
      childNodeCount: 1,
      children: [{ nodeType: 3, nodeName: "#text", nodeValue: "hi" }],
    }
    const prunedNode = pruneDocument(withHandle)
    expect(prunedNode.nodeId).toBeUndefined()
    expect(prunedNode.backendNodeId).toBe(7)
    expect(prunedNode.children?.[0]?.nodeValue).toBe("hi")

    // Nodes stay, and so do the counts: a parent whose count exceeds the
    // children it carries is how the reader sees a cut subtree.
    expect(findNode(pruned, (node) => node.nodeType === 8)).toBeDefined()
    const form = findNode(pruned, (node) => node.nodeName === "FORM")
    expect(form?.childNodeCount).toBe(
      findNode(built.dom, (node) => node.nodeName === "FORM")?.childNodeCount
    )
    expect(form?.children?.length).toBe(form?.childNodeCount)
  })

  it("drops the accessibility scaffolding the reader never asks for", () => {
    const built = chromeLikeAx(buildPage(RICH_PAGE))
    const pruned = pruneAx(built.ax)
    const withProperties = pruned.find(
      (node) => (node.properties?.length ?? 0) > 0
    )

    for (const node of pruned) {
      expect(node.childIds).toBeUndefined()
      expect(node.parentId).toBeUndefined()
      expect(node.ignored).toBeUndefined()
      for (const property of node.properties ?? [])
        expect([
          "checked",
          "disabled",
          "multiselectable",
          "readonly",
          "required",
          "selected",
        ]).toContain(property.name)
    }
    // The name and the browser id are the join and the wording both, so they
    // survive the prune on every node that has one.
    expect(withProperties?.backendDOMNodeId).toBeDefined()
    expect(pruned.length).toBe(built.ax.length)

    // A node the reader cannot address is a node it cannot read, so the prune
    // takes it; the join is by browser id and nothing else.
    const unreachable: AxNode = {
      nodeId: "ax-synthetic",
      role: { type: "role", value: "generic" },
      name: { type: "string", value: "container" },
    }
    expect(pruneAx([...built.ax, unreachable]).length).toBe(built.ax.length)
  })

  it("names a recording by site, page and capture date", () => {
    expect(
      fixturePath({
        site: "Ashby",
        name: "Application form",
        capturedAt: "2026-10-14T12:00:00.000Z",
      })
    ).toBe("ashby/application-form-2026-10-14.json")
    expect(slug("  Lever / apply  ")).toBe("lever-apply")
    expect(slug("***")).toBe("")
  })

  it("refuses a recording taken for a different reader", () => {
    const fixture = recordPage({ root: buildPage(RICH_PAGE) })
    const newer = { ...fixture, version: fixture.version + 1 }

    const decoded = decodeFixture(newer)
    expect(decoded.ok).toBe(false)
    if (decoded.ok) throw new Error("a newer recording was accepted")
    expect(decoded.problem).toContain("different reader")

    const corrupt = decodeFixture({ ...fixture, contexts: [] })
    expect(corrupt.ok).toBe(false)
    if (corrupt.ok) throw new Error("an empty recording was accepted")
    expect(corrupt.problem).toContain("contexts")
  })
})

describe("replaying a recording", () => {
  it("reads a pruned recording exactly as it read the payload it came from", async () => {
    const root = chromeLikeAx(buildPage(RICH_PAGE))
    const raw = recordPage({ root, prune: false })
    const pruned = recordPage({ root, prune: true })

    const before = await observeFixture(raw)
    const after = await observeFixture(pruned)

    // The comparison is only worth anything if the page was really read.
    expect(before.observation.nodes.length).toBeGreaterThan(12)
    expect(before.observation.coverage.complete).toBe(true)

    expect(after.observation.nodes).toEqual(before.observation.nodes)
    expect(after.observation.regions).toEqual(before.observation.regions)
    expect(after.observation.contexts).toEqual(before.observation.contexts)
    expect(after.observation.coverage).toEqual(before.observation.coverage)

    // And the prune is not cosmetic: it is what makes a recording committable.
    expect(JSON.stringify(pruned).length).toBeLessThan(
      JSON.stringify(raw).length
    )
  })

  it("reads a recorded shadow root as its own context", async () => {
    const fixture = recordPage({ root: shadowPage() })
    const read = await observeFixture(fixture)

    expect(fixture.contexts[0]?.document?.shadowRoots).toHaveLength(1)
    expect(
      read.observation.nodes.some((node) => node.name === "Shadow field")
    ).toBe(true)
  })

  it("cuts a recorded document to the depth the read asked for", () => {
    const tree: DomNode = {
      nodeType: 9,
      nodeName: "#document",
      childNodeCount: 1,
      children: [
        {
          nodeType: 1,
          nodeName: "DIV",
          backendNodeId: 1,
          childNodeCount: 1,
          children: [
            {
              nodeType: 1,
              nodeName: "INPUT",
              backendNodeId: 2,
              childNodeCount: 0,
              children: [],
            },
          ],
        },
      ],
    }

    // A recording is kept whole, because a later read may ask for any depth.
    expect(truncateDocument(tree, -1)).toBe(tree)

    // One level is the node and its children, with their children dropped. The
    // count stays, which is the only reason a cut is visible at all.
    const one = truncateDocument(tree, 1)
    expect(one.children?.[0]?.nodeName).toBe("DIV")
    expect(one.children?.[0]?.children).toBeUndefined()
    expect(one.children?.[0]?.childNodeCount).toBe(1)

    const two = truncateDocument(tree, 2)
    expect(two.children?.[0]?.children?.[0]?.nodeName).toBe("INPUT")

    const none = truncateDocument(tree, 0)
    expect(none.children).toBeUndefined()
    expect(none.shadowRoots).toBeUndefined()
  })

  it("serves a read at the ceiling a tree cut the way the browser cuts it", async () => {
    const deep = `${"<div>".repeat(45)}<input name="deep" aria-label="Deep">${"</div>".repeat(45)}`
    const fixture = recordPage({ root: buildPage(deep) })
    const page = pageFromFixture(fixture)

    const answer = async (depth: number): Promise<number> => {
      const served = (await page.transport.send(null, "DOM.getDocument", {
        depth,
        pierce: true,
      })) as { root: DomNode }
      return levelsOf(served.root)
    }

    // The recording is whole; a read at the ceiling is cut, and no deeper than
    // the ceiling. This is what the stand-in could not model, and why a
    // recording can show a reader problem the stand-in hides.
    expect(await answer(-1)).toBeGreaterThan(await answer(40))
    expect(await answer(40)).toBe(41)
  })

  it("reports a recording whose tree a live read would have cut", async () => {
    const deep = `${"<div>".repeat(45)}<input name="deep" aria-label="Deep">${"</div>".repeat(45)}`
    const read = await observeFixture(recordPage({ root: buildPage(deep) }))

    // The control below the boundary is missing, which is a real loss.
    expect(read.observation.nodes.some((node) => node.name === "Deep")).toBe(
      false
    )

    // And today the loss is not reported: completeness is computed from the gaps
    // the walk found, the boundary node holds no control and no planned child so
    // `planNode` returns null for it, and the child-count check lives in `emit`,
    // which a node without a plan never reaches. The stand-in never cut a tree,
    // so the reader's own ceiling was the only thing this ever exercised; with a
    // tree cut the way Chrome cuts it, a page read past the ceiling reports
    // itself complete. This is a reader change, reported rather than made here:
    // ticket 05 owns the recorder and the loader, not `src/dom-agent`.
    expect(read.observation.coverage.complete).toBe(true)
  })

  it("replays a recorded frame as its own context", async () => {
    const fixture = recordPage({
      root: buildPage(RICH_PAGE),
      frames: [
        {
          sessionId: "frame-session-1",
          url: "https://frame.example/apply",
          page: buildPage(FRAME_PAGE),
        },
      ],
    })
    const read = await observeFixture(fixture)

    expect(read.observation.contexts.map((context) => context.id)).toContain(
      "frame-session-1"
    )
    expect(
      read.observation.nodes.some((node) => node.name === "Cover letter")
    ).toBe(true)
    expect(read.observation.coverage.complete).toBe(true)
  })

  it("takes existing tests' pages through the same load path", async () => {
    const { session } = await attachPage({
      transport: pageFromMarkup(`<label for="a">Name</label><input id="a">`),
    })
    const read = await observePage({ session, id: "obs-markup" })

    expect(read.observation.nodes.map((node) => node.name)).toContain("Name")
    expect(read.observation.coverage.complete).toBe(true)
    await session.detach()
  })
})

describe("the recorder", () => {
  function scripted(handlers: {
    [method: string]: (
      params: Record<string, unknown>,
      sessionId: string | null
    ) => unknown
  }): {
    connection: CdpConnection
    calls: Array<{
      method: string
      params: Record<string, unknown>
      sessionId: string | null
    }>
  } {
    const calls: Array<{
      method: string
      params: Record<string, unknown>
      sessionId: string | null
    }> = []
    return {
      calls,
      connection: {
        async send(method, params = {}, sessionId = null) {
          calls.push({ method, params, sessionId })
          const handler = handlers[method]
          if (!handler) return {}
          return handler(params, sessionId)
        },
        on() {},
        close() {},
      },
    }
  }

  const root = buildPage(RICH_PAGE)
  const frame = buildPage(FRAME_PAGE)

  function frameHandler(sessionId: string | null): boolean {
    return sessionId === "frame-session-1"
  }

  it("records the tab and every frame session with the capture beside it", async () => {
    const { connection, calls } = scripted({
      "Target.setDiscoverTargets": () => ({}),
      "Target.getTargets": () => ({
        targetInfos: [
          {
            targetId: "frame-target",
            type: "iframe",
            url: "https://frame.example/apply",
          },
          {
            targetId: "page-target",
            type: "page",
            url: "https://jobs.ashbyhq.com/acme/apply",
          },
        ],
      }),
      "Target.attachToTarget": () => ({ sessionId: "frame-session-1" }),
      "DOM.getDocument": (_params, sessionId) =>
        frameHandler(sessionId) ? { root: frame.dom } : { root: root.dom },
      "Accessibility.getFullAXTree": (_params, sessionId) =>
        frameHandler(sessionId) ? { nodes: frame.ax } : { nodes: root.ax },
      "Target.detachFromTarget": () => ({}),
    })

    const fixture = await capturePage({
      connection,
      site: "ashby",
      url: "https://jobs.ashbyhq.com/acme/apply",
      extensionVersion: "0.1.0",
      capturedAt: "2026-10-14T12:00:00.000Z",
    })

    expect(fixture.capture).toEqual({
      site: "ashby",
      url: "https://jobs.ashbyhq.com/acme/apply",
      capturedAt: "2026-10-14T12:00:00.000Z",
      extensionVersion: "0.1.0",
      method: "cdp-websocket",
    })
    expect(fixture.contexts.map((context) => context.sessionId)).toEqual([
      null,
      "frame-session-1",
    ])
    expect(fixture.contexts[1]?.kind).toBe("frame")
    expect(fixture.contexts[1]?.url).toBe("https://frame.example/apply")

    // A recording has to answer a later read at any depth, so the capture asks
    // for the whole document rather than the depth the reader happens to use.
    const document = calls.filter((call) => call.method === "DOM.getDocument")
    expect(document).toHaveLength(2)
    for (const call of document) expect(call.params.depth).toBe(-1)

    // The user keeps their browser: the capture detaches what it attached.
    expect(calls.map((call) => call.method)).toContain(
      "Target.detachFromTarget"
    )
  })

  it("replays a frame that refused the document read as the gap it caused", async () => {
    const { connection } = scripted({
      "Target.setDiscoverTargets": () => ({}),
      "Target.getTargets": () => ({
        targetInfos: [
          {
            targetId: "frame-target",
            type: "iframe",
            url: "https://frame.example/apply",
          },
        ],
      }),
      "Target.attachToTarget": () => ({ sessionId: "frame-session-1" }),
      "DOM.getDocument": (_params, sessionId) => {
        if (frameHandler(sessionId)) throw new Error("Cross origin")
        return { root: root.dom }
      },
      "Accessibility.getFullAXTree": () => ({ nodes: root.ax }),
      "Target.detachFromTarget": () => ({}),
    })

    const fixture = await capturePage({
      connection,
      site: "greenhouse",
      url: "https://boards.greenhouse.io/acme/jobs/1",
      extensionVersion: "0.1.0",
      capturedAt: "2026-10-14T12:00:00.000Z",
    })

    // The frame is recorded as refusing rather than dropped: a recording that
    // omitted it would replay as a page where nothing was missing.
    expect(fixture.contexts).toHaveLength(2)
    expect(fixture.contexts[1]?.document).toBeNull()

    const read = await observeFixture(fixture)
    expect(read.observation.coverage.complete).toBe(false)
    expect(
      read.observation.coverage.gaps.some(
        (gap) => gap.reason === "cross_origin"
      )
    ).toBe(true)
  })

  it("refuses to record when the tab itself cannot be read", async () => {
    const { connection } = scripted({
      "Target.setDiscoverTargets": () => ({}),
      "Target.getTargets": () => ({ targetInfos: [] }),
      "DOM.getDocument": () => {
        throw new Error("Cannot access contents of the page")
      },
    })

    await expect(
      capturePage({
        connection,
        site: "lever",
        url: "https://jobs.lever.co/acme/1",
        extensionVersion: "0.1.0",
      })
    ).rejects.toThrow("Cannot access contents of the page")
  })

  it("records an accessibility read that failed instead of an empty tree", async () => {
    const { connection } = scripted({
      "Target.setDiscoverTargets": () => ({}),
      "Target.getTargets": () => ({ targetInfos: [] }),
      "DOM.getDocument": () => ({ root: root.dom }),
      "Accessibility.getFullAXTree": () => ({ nonsense: true }),
    })

    const fixture = await capturePage({
      connection,
      site: "ashby",
      url: "https://jobs.ashbyhq.com/acme/apply",
      extensionVersion: "0.1.0",
    })

    expect(fixture.contexts[0]?.axFailed).toBe(true)
    expect(fixture.contexts[0]?.ax).toEqual([])

    // The replay fails the same read, so the reader reports what it reported
    // live rather than a page that had no accessibility tree at all.
    const page = pageFromFixture(fixture)
    await expect(
      page.transport.send(null, "Accessibility.getFullAXTree", {})
    ).rejects.toThrow("could not be read")
  })
})

describe("the protocol channel", () => {
  function fakeSocket() {
    let message: ((data: string) => void) | null = null
    let closed: (() => void) | null = null
    const sent: string[] = []
    const socket: CdpSocket = {
      send: (data) => {
        sent.push(data)
      },
      close: () => {
        closed?.()
      },
      onMessage: (handler) => {
        message = handler
      },
      onClose: (handler) => {
        closed = handler
      },
    }
    return {
      socket,
      sent,
      deliver: (payload: unknown) => message?.(JSON.stringify(payload)),
      drop: () => closed?.(),
    }
  }

  function sentMessage(data: string): {
    id: number
    method: string
    sessionId?: string
  } {
    return JSON.parse(data)
  }

  it("correlates answers with requests and routes events by session", async () => {
    const { socket, sent, deliver } = fakeSocket()
    const connection = createCdpConnection(socket)
    const events: Array<{ url: string; sessionId: string }> = []
    connection.on("Target.attachedToTarget", (params, sessionId) => {
      events.push({
        url: String((params.targetInfo as { url?: string })?.url ?? ""),
        sessionId,
      })
    })

    const first = connection.send("DOM.getDocument", { depth: -1 })
    const second = connection.send(
      "Accessibility.getFullAXTree",
      {},
      "frame-session-1"
    )
    expect(sent).toHaveLength(2)
    const ids = sent.map((data) => sentMessage(data).id)

    // Out of order on purpose: the protocol answers when it answers.
    deliver({ id: ids[1], result: { nodes: [] } })
    deliver({
      id: ids[0],
      result: { root: { nodeType: 9, nodeName: "#document" } },
    })

    await expect(first).resolves.toEqual({
      root: { nodeType: 9, nodeName: "#document" },
    })
    await expect(second).resolves.toEqual({ nodes: [] })
    // The session a command belongs to travels with it, which is how a frame is
    // addressed at all.
    expect(sentMessage(sent[1] ?? "").sessionId).toBe("frame-session-1")

    deliver({
      method: "Target.attachedToTarget",
      sessionId: "frame-session-1",
      params: { targetInfo: { url: "https://frame.example/apply" } },
    })
    expect(events).toEqual([
      { url: "https://frame.example/apply", sessionId: "frame-session-1" },
    ])
  })

  it("fails a request the browser answered with an error, naming the method", async () => {
    const { socket, sent, deliver } = fakeSocket()
    const connection = createCdpConnection(socket)

    const pending = connection.send("DOM.getDocument", { depth: -1 })
    const id = sentMessage(sent[0] ?? "").id
    deliver({ id, error: { code: -32000, message: "Target closed" } })

    await expect(pending).rejects.toThrow("DOM.getDocument: Target closed")
  })

  it("fails a request the browser never answers, and every wait if it drops", async () => {
    const silent = fakeSocket()
    const connection = createCdpConnection(silent.socket, 5)
    await expect(connection.send("DOM.getDocument", {})).rejects.toThrow(
      "no answer within 5ms"
    )

    const dropped = fakeSocket()
    const other = createCdpConnection(dropped.socket)
    const pending = other.send("DOM.getDocument", {})
    dropped.drop()
    await expect(pending).rejects.toThrow("the connection closed")
    // After a close nothing is sent, because a command with no browser behind
    // it would otherwise wait for a timeout to say so.
    await expect(other.send("DOM.getDocument", {})).rejects.toThrow(
      "the connection closed"
    )
  })

  it("picks the page to capture, and says what else was open", () => {
    const target = (url: string, type = "page"): CdpTarget => ({
      id: url,
      type,
      url,
      title: "",
      webSocketDebuggerUrl: `ws://127.0.0.1/${url}`,
    })
    const pages = [
      target("https://jobs.ashbyhq.com/acme/apply"),
      target("https://boards.greenhouse.io/acme/jobs/1"),
    ]

    expect(pickPageTarget(pages, "greenhouse")?.url).toContain("greenhouse")
    expect(pickPageTarget([pages[0] as CdpTarget], null)?.url).toContain(
      "ashby"
    )

    expect(() => pickPageTarget(pages, null)).toThrow(/2 pages matched/)
    expect(() => pickPageTarget(pages, "lever")).toThrow(
      /no open page matched "lever"/
    )
    expect(() =>
      pickPageTarget([target("devtools://x", "other")], null)
    ).toThrow(/no open page to capture/)
  })
})

describe("the fixture directory", () => {
  it("loads a recording from disk and lists what is there", () => {
    const base = mkdtempSync(join(tmpdir(), "dom-agent-fixture-"))
    try {
      const fixture = recordPage({
        root: buildPage(RICH_PAGE),
        capture: {
          site: "ashby",
          url: "https://jobs.ashbyhq.com/acme/apply",
          capturedAt: "2026-10-14T12:00:00.000Z",
          extensionVersion: "0.1.0",
        },
      })
      const name = fixturePath({
        site: "ashby",
        name: "application",
        capturedAt: fixture.capture.capturedAt,
      })
      mkdirSync(dirname(join(base, name)), { recursive: true })
      writeFileSync(join(base, name), `${JSON.stringify(fixture, null, 2)}\n`)

      expect(listFixtures(base)).toEqual([name])
      const loaded = loadFixture(name, base)
      expect(loaded.capture).toEqual(fixture.capture)
      expect(loaded.contexts[0]?.document?.backendNodeId).toBe(
        fixture.contexts[0]?.document?.backendNodeId
      )

      // A file that no longer matches the shape names the problem, so a broken
      // recording reads as broken rather than as a page with less on it.
      writeFileSync(
        join(base, name),
        JSON.stringify({ ...fixture, version: 9 })
      )
      expect(() => loadFixture(name, base)).toThrow(/different reader/)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("is where the recorder writes and the loader reads", () => {
    expect(FIXTURES_DIR.endsWith(FIXTURES_RELATIVE)).toBe(true)
    expect(
      join(
        FIXTURES_DIR,
        fixturePath({
          site: "lever",
          name: "apply",
          capturedAt: "2026-10-14T00:00:00.000Z",
        })
      ).startsWith(FIXTURES_DIR)
    ).toBe(true)
  })

  it("is never reached from anything the extension ships", () => {
    const src = join(FIXTURES_DIR, "..", "..", "src")
    for (const file of sourceFiles(src)) {
      const body = readFileSync(file, "utf8")
      expect(body).not.toMatch(/from\s+["'][^"']*tools\//)
      expect(body).not.toContain("capture-fixture")
    }
  })
})

/** The recordings, once the user has taken them. */
const recordings = listFixtures()
describe.skipIf(recordings.length === 0)("recorded pages", () => {
  const GAP_REASONS = [
    "truncated",
    "inaccessible",
    "unsupported",
    "cross_origin",
    "closed_shadow",
    "budget",
  ]

  for (const name of recordings) {
    it(`replays ${name} the way it was read`, async () => {
      const fixture = loadFixture(name)
      const read = await observeFixture(fixture)

      // Every gap has to be one the reader can report, which is how a payload
      // that no longer parses shows up as a failure rather than a silent gap.
      for (const gap of read.observation.coverage.gaps)
        expect(GAP_REASONS).toContain(gap.reason)
      expect(read.observation.contexts.length).toBeGreaterThan(0)

      const again = await observeFixture(fixture)
      expect(again.observation.nodes).toEqual(read.observation.nodes)
      expect(again.observation.coverage).toEqual(read.observation.coverage)
    })
  }
})

function findNode(
  node: DomNode,
  match: (candidate: DomNode) => boolean
): DomNode | undefined {
  if (match(node)) return node
  for (const child of node.children ?? []) {
    const found = findNode(child, match)
    if (found) return found
  }
  return undefined
}

function levelsOf(node: DomNode): number {
  let deepest = 0
  for (const child of node.children ?? [])
    deepest = Math.max(deepest, levelsOf(child))
  return deepest + 1
}

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path)
  }
  return found
}
