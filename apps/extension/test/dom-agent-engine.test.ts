import { describe, expect, it } from "vitest"
import { domAgentEngineStatus, engineCanStart } from "../src/dom-agent/engine"

describe("dom agent engine status", () => {
  it("starts only for a status that is explicitly ready", () => {
    expect(engineCanStart({ ready: false, reason: "being replaced" })).toBe(
      false
    )
    expect(engineCanStart({ ready: true })).toBe(true)
  })

  // Tripwire: every ticket between 01 and 09 keeps filling refused. Flipping
  // this is part of ticket 09, when the deterministic answer path works.
  it("refuses to start a fill run in this build", () => {
    expect(domAgentEngineStatus.ready).toBe(false)
    expect(engineCanStart()).toBe(false)
  })
})
