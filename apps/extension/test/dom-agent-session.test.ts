import { afterEach, describe, expect, it, vi } from "vitest"
import { UNKNOWN_APPLICATION } from "@workspace/resume-core/dom-agent"
import { createDebuggerHarness } from "./helpers/chrome-debugger"
import {
  DriverClosedError,
  DriverSession,
  StaleContextError,
  StaleResultError,
  UnreviewedMethodError,
} from "../src/dom-agent/session"

const TAB = 7
const RUN = "run-1"

function install() {
  const harness = createDebuggerHarness(TAB)
  vi.stubGlobal("chrome", harness.chrome)
  return harness
}

afterEach(() => vi.unstubAllGlobals())

describe("attaching for a run", () => {
  it("probes what the browser actually gives, rather than assuming", async () => {
    const harness = install()
    const session = await DriverSession.attach({ tabId: TAB, runId: RUN })
    expect(harness.attachedTabs).toEqual([TAB])
    expect(harness.methods()).toContain("DOM.getDocument")
    expect(harness.methods()).toContain("Accessibility.getFullAXTree")
    expect(harness.methods()).toContain("Target.setAutoAttach")
    expect(session.capability).toEqual({
      accessibility: true,
      dom: true,
      childSessions: true,
    })
    expect(session.fillable).toBe(true)
    expect(session.generation).toBe(1)
    await session.detach()
  })

  it("refuses to attach without a run that owns the session", async () => {
    install()
    await expect(
      DriverSession.attach({ tabId: TAB, runId: "" })
    ).rejects.toThrow(/needs a run/)
  })

  it("reports missing accessibility and stops filling instead of falling back", async () => {
    const harness = install()
    harness.fail("Accessibility.getFullAXTree", "Not supported")
    const session = await DriverSession.attach({ tabId: TAB, runId: RUN })
    expect(session.capability.accessibility).toBe(false)
    expect(session.capability.dom).toBe(true)
    expect(session.fillable).toBe(false)
    // No second reader is consulted: the only commands issued are the probe.
    expect(
      harness.methods().filter((m) => m.startsWith("Accessibility."))
    ).toEqual(["Accessibility.enable", "Accessibility.getFullAXTree"])
    await session.detach()
  })

  it("keeps going when only child sessions are unavailable", async () => {
    const harness = install()
    harness.fail("Target.setAutoAttach", "Not supported")
    const session = await DriverSession.attach({ tabId: TAB, runId: RUN })
    expect(session.capability).toEqual({
      accessibility: true,
      dom: true,
      childSessions: false,
    })
    expect(session.fillable).toBe(true)
    await session.detach()
  })

  it("re-probes on every attach and never reuses a previous capability", async () => {
    install()
    const one = await DriverSession.attach({ tabId: TAB, runId: RUN })
    expect(one.fillable).toBe(true)
    await one.detach()

    const second = install()
    second.fail("Accessibility.enable")
    const two = await DriverSession.attach({ tabId: TAB, runId: "run-2" })
    expect(two.fillable).toBe(false)
    await two.detach()
  })
})

describe("invalidation", () => {
  it("drops every reference when the document is replaced", async () => {
    const harness = install()
    const session = await DriverSession.attach({ tabId: TAB, runId: RUN })
    const reasons: string[] = []
    session.onInvalidate((reason) => reasons.push(reason))

    harness.emit("DOM.documentUpdated")

    expect(session.generation).toBe(2)
    expect(session.contextList).toHaveLength(0)
    expect(reasons).toEqual(["document_replaced"])
    await expect(
      session.send("root", "DOM.getDocument", { depth: 0, pierce: false })
    ).rejects.toBeInstanceOf(StaleContextError)
    await session.detach()
  })

  it("discards a result that a page change overtook", async () => {
    const harness = install()
    const session = await DriverSession.attach({ tabId: TAB, runId: RUN })
    let release: (() => void) | undefined
    harness.on("DOM.getBoxModel", () => {
      harness.emit("Page.frameNavigated")
      return {}
    })
    const inflight = session.send("root", "DOM.getBoxModel", {})
    release?.()
    await expect(inflight).rejects.toBeInstanceOf(StaleResultError)
    await session.detach()
  })

  it("tracks an out-of-process frame as its own session", async () => {
    const harness = install()
    const session = await DriverSession.attach({ tabId: TAB, runId: RUN })
    harness.emit("Target.attachedToTarget", {
      sessionId: "child-1",
      targetInfo: { targetId: "target-9", url: "https://frame.test/form" },
    })
    const child = session.context("child-1")
    expect(child?.kind).toBe("frame")
    expect(child?.sessionId).toBe("child-1")
    expect(child?.url).toBe("https://frame.test/form")

    await session.send("child-1", "DOM.getDocument", {
      depth: 0,
      pierce: false,
    })
    const sent = harness.commands.at(-1)
    expect(sent?.sessionId).toBe("child-1")
    await session.detach()
  })

  it("invalidates when a child session goes away", async () => {
    const harness = install()
    const session = await DriverSession.attach({ tabId: TAB, runId: RUN })
    harness.emit("Target.attachedToTarget", { sessionId: "child-1" })
    expect(session.generation).toBe(1)
    harness.emit("Target.detachedFromTarget", {}, "child-1")
    expect(session.generation).toBe(2)
    expect(session.context("child-1")).toBeUndefined()
    await session.detach()
  })
})

describe("closing", () => {
  it("stops filling and releases the observation before detaching", async () => {
    const harness = install()
    const session = await DriverSession.attach({ tabId: TAB, runId: RUN })
    await session.detach()
    expect(harness.attachedTabs).toEqual([])
    expect(harness.methods()).toContain("Accessibility.disable")
    expect(session.fillable).toBe(false)
    await expect(session.send("root", "DOM.enable")).rejects.toBeInstanceOf(
      DriverClosedError
    )
  })

  it("reports a detach that it did not ask for", async () => {
    const harness = install()
    const session = await DriverSession.attach({ tabId: TAB, runId: RUN })
    const reasons: string[] = []
    session.onInvalidate((reason) => reasons.push(reason))
    harness.emitDetach("replaced_with_devtools")
    expect(reasons).toEqual(["detached"])
    expect(session.fillable).toBe(false)
    expect(harness.listenerCount()).toEqual({ events: 0, detaches: 0 })
  })

  it("does not survive a detach by keeping stale references", async () => {
    const harness = install()
    const session = await DriverSession.attach({ tabId: TAB, runId: RUN })
    harness.emit("Target.attachedToTarget", { sessionId: "child-1" })
    harness.emitDetach()
    expect(session.contextList).toHaveLength(0)
    expect(session.context("child-1")).toBeUndefined()
    await expect(session.send("child-1", "DOM.enable")).rejects.toBeInstanceOf(
      DriverClosedError
    )
  })
})

describe("transport discipline", () => {
  it("refuses a method this engine has not reviewed", async () => {
    install()
    const session = await DriverSession.attach({ tabId: TAB, runId: RUN })
    await expect(
      session.send("root", "Page.navigate" as never, { url: "https://x.test" })
    ).rejects.toBeInstanceOf(UnreviewedMethodError)
    await session.detach()
  })

  it("never joins contexts by a numeric identifier", async () => {
    const harness = install()
    const session = await DriverSession.attach({ tabId: TAB, runId: RUN })
    harness.emit("Target.attachedToTarget", {
      sessionId: "child-1",
      targetInfo: { targetId: "9" },
    })
    expect(session.context("9")).toBeUndefined()
    expect(session.context("child-1")).toBeDefined()
    expect(session.context("root")).toBeDefined()
    await session.detach()
  })
})

describe("the harness itself", () => {
  it("stays out of the way of unrelated platform APIs", () => {
    const harness = install()
    expect(UNKNOWN_APPLICATION).toBe("unknown")
    expect(harness.listenerCount()).toEqual({ events: 0, detaches: 0 })
  })
})
