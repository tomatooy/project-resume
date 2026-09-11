// @vitest-environment node
import type { TurnOutcome } from "@workspace/agent"
import { createServices } from "@workspace/resume-core"
import {
  InMemoryBackground,
  inMemoryPorts,
} from "@workspace/resume-core/testing"
import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"

import type { Logger } from "../log"
import { type OpenRun, settleRun } from "./run-lifecycle"

/** Every log line by event name, so a test can ask what was reported. */
function recordingLog() {
  const events: string[] = []
  const log: Logger = {
    info: (event) => void events.push(event),
    warn: (event) => void events.push(event),
    error: (event) => void events.push(event),
  }
  return { log, events }
}

async function harness() {
  const ports = inMemoryPorts()
  const { db } = ports
  const services = createServices(ports)
  const background = new InMemoryBackground()
  const { log, events } = recordingLog()

  const summary = await services.resumes.create({ title: "Lifecycle" })
  const conversation = await services.memory.openConversation(summary.id)
  const run = await services.runs.start({
    conversationId: conversation.id,
    resumeId: summary.id,
    hintSkillId: "bullet_rewrite",
    model: "smart-test",
    selectedNodeId: null,
    input: {},
  })
  const startedAt = db.now().getTime()
  db.advance()

  const open: OpenRun = {
    run,
    model: "smart-test",
    metadata: { hintSkillId: "bullet_rewrite", structural: false },
    startedAt,
  }
  const deps = { services, background, log, now: () => db.now() }
  return { db, services, background, events, open, deps }
}

const reply: UIMessage = {
  id: "a1",
  role: "assistant",
  parts: [{ type: "text", text: "Done." }],
}

function outcome(status: TurnOutcome["status"], error?: unknown): TurnOutcome {
  return {
    status,
    usage: { inputTokens: 120, outputTokens: 30, steps: 2 },
    message: reply,
    budgetExhausted: false,
    error,
  }
}

describe("settleRun", () => {
  it("stores the reply, closes the run with usage, and queues consolidation", async () => {
    const h = await harness()
    await settleRun(h.deps, h.open, outcome("completed"))

    const run = h.db.runs[0]
    expect(run?.status).toBe("completed")
    expect(run?.errorClass).toBeNull()
    expect(run?.inputTokens).toBe(120)
    expect(run?.outputTokens).toBe(30)
    expect(run?.latencyMs).toBeGreaterThan(0)

    const stored = h.db.messages
    expect(stored).toHaveLength(1)
    expect(stored[0]?.role).toBe("assistant")
    expect(stored[0]?.agentRunId).toBe(run?.id)
    expect(stored[0]?.metadata).toEqual({
      hintSkillId: "bullet_rewrite",
      structural: false,
    })

    await h.background.flush()
    expect(h.background.tasks).toHaveLength(1)
    expect(h.events).toEqual(["chat_finished", "memory_consolidation"])
  })

  it("leaves a paused run open and stores nothing", async () => {
    const h = await harness()
    await settleRun(h.deps, h.open, outcome("paused"))

    expect(h.db.runs[0]?.status).toBe("running")
    expect(h.db.messages).toHaveLength(0)
    expect(h.background.tasks).toHaveLength(0)
    expect(h.events).toEqual(["chat_paused"])
  })

  it("marks a cancelled reply as stopped and the run as aborted", async () => {
    const h = await harness()
    await settleRun(h.deps, h.open, outcome("cancelled"))

    expect(h.db.runs[0]?.status).toBe("cancelled")
    expect(h.db.runs[0]?.errorClass).toBe("aborted")
    expect(h.db.messages[0]?.metadata).toEqual({
      hintSkillId: "bullet_rewrite",
      structural: false,
      stopped: true,
    })
  })

  it("classifies the failure on the run and reports it", async () => {
    const h = await harness()
    await settleRun(h.deps, h.open, outcome("failed", new TypeError("boom")))

    expect(h.db.runs[0]?.status).toBe("failed")
    expect(h.db.runs[0]?.errorClass).toBe("TypeError")
    await h.background.flush()
    expect(h.events).toEqual([
      "chat_stream_error",
      "chat_finished",
      "memory_consolidation",
    ])
  })

  it("reports a store that refuses the row instead of throwing", async () => {
    const h = await harness()
    h.services.runs.finish = async () => {
      throw new Error("down")
    }
    await expect(
      settleRun(h.deps, h.open, outcome("completed"))
    ).resolves.toBeUndefined()

    expect(h.db.runs[0]?.status).toBe("running")
    expect(h.events).toContain("chat_finish_failed")
    expect(h.events).toContain("chat_finished")
  })
})
