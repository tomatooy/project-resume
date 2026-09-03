import { describe, expect, it } from "vitest"

import type { MemorySummary } from "../src/domain/memory"
import { harness } from "./harness"

async function seeded() {
  const h = harness()
  const { id: resumeId } = await h.resumeService.create({ title: "CV" })
  const { id: conversationId } = await h.conversations.getOrCreate(resumeId)
  let n = 0
  const say = async (count: number) => {
    for (let i = 0; i < count; i += 1) {
      n += 1
      await h.messages.append({
        conversationId,
        role: n % 2 === 1 ? "user" : "assistant",
        parts: [{ type: "text", text: `message ${n}` }],
        agentRunId: null,
        metadata: {},
      })
    }
  }
  return { ...h, conversationId, say }
}

const SUMMARY: MemorySummary = {
  user_goal: "Land a staff role",
  resume_focus: ["leadership"],
  preferences: ["short bullets"],
  decisions: ["kept the Acme role"],
  open_tasks: [],
}

describe("MemoryService.buildContext", () => {
  it("returns the last 12 messages in order when there is no summary", async () => {
    const h = await seeded()
    await h.say(15)

    const context = await h.memoryService.buildContext(h.conversationId)

    expect(context.summaryText).toBeNull()
    expect(context.messages).toHaveLength(12)
    expect(context.messages.map((m) => m.seq)).toEqual(
      [...Array(12)].map((_, i) => i + 4)
    )
  })

  it("returns the summary and only the messages after it", async () => {
    const h = await seeded()
    h.summarizer.result = SUMMARY
    await h.say(12)
    await h.memoryService.maybeConsolidate(h.conversationId)
    await h.say(3)

    const context = await h.memoryService.buildContext(h.conversationId)

    expect(context.summaryText).toContain("Land a staff role")
    expect(context.messages.map((m) => m.seq)).toEqual([13, 14, 15])
  })
})

describe("MemoryService.maybeConsolidate", () => {
  it("skips below the threshold", async () => {
    const h = await seeded()
    await h.say(11)

    const outcome = await h.memoryService.maybeConsolidate(h.conversationId)

    expect(outcome).toBe("skipped")
    expect(h.summarizer.calls).toHaveLength(0)
    expect(await h.summaries.findActive(h.conversationId)).toBeNull()
  })

  it("summarises at the threshold and activates the result", async () => {
    const h = await seeded()
    h.summarizer.result = SUMMARY
    h.summarizer.model = "fast-model"
    await h.say(12)

    const outcome = await h.memoryService.maybeConsolidate(h.conversationId)

    expect(outcome).toBe("consolidated")
    const active = await h.summaries.findActive(h.conversationId)
    expect(active?.summary).toEqual(SUMMARY)
    expect(active?.sourceFromSeq).toBe(1)
    expect(active?.sourceToSeq).toBe(12)
    expect(active?.model).toBe("fast-model")
    expect(active?.summaryText).toContain("Land a staff role")
    expect(h.summarizer.calls[0]?.previous).toBeNull()
    expect(h.summarizer.calls[0]?.messages).toHaveLength(12)
  })

  it("chains a second summary from the first", async () => {
    const h = await seeded()
    h.summarizer.result = SUMMARY
    await h.say(12)
    await h.memoryService.maybeConsolidate(h.conversationId)
    const later: MemorySummary = {
      ...SUMMARY,
      open_tasks: ["quantify bullet 2"],
    }
    h.summarizer.result = later
    await h.say(12)

    const outcome = await h.memoryService.maybeConsolidate(h.conversationId)

    expect(outcome).toBe("consolidated")
    expect(h.summarizer.calls[1]?.previous).toEqual(SUMMARY)
    expect(h.summarizer.calls[1]?.messages.map((m) => m.seq)).toEqual(
      [...Array(12)].map((_, i) => i + 13)
    )
    const active = await h.summaries.findActive(h.conversationId)
    expect(active?.summary).toEqual(later)
    expect(active?.sourceFromSeq).toBe(13)
    expect(active?.sourceToSeq).toBe(24)
  })

  it("leaves the previous summary active when the summariser fails", async () => {
    const h = await seeded()
    h.summarizer.result = SUMMARY
    await h.say(12)
    await h.memoryService.maybeConsolidate(h.conversationId)
    h.summarizer.failWith = new Error("provider down")
    await h.say(12)

    await expect(
      h.memoryService.maybeConsolidate(h.conversationId)
    ).rejects.toThrow("provider down")

    const active = await h.summaries.findActive(h.conversationId)
    expect(active?.sourceToSeq).toBe(12)
  })
})

describe("MemoryService.history", () => {
  it("returns every message in order for hydration", async () => {
    const h = await seeded()
    await h.say(5)

    const history = await h.memoryService.history(h.conversationId)

    expect(history.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5])
    expect(history[0]?.role).toBe("user")
    expect(history[0]?.parts).toEqual([{ type: "text", text: "message 1" }])
  })
})
