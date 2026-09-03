import type { ChatMessage, MemorySummary } from "@workspace/resume-core"
import { MockLanguageModelV3 } from "ai/test"
import { describe, expect, it } from "vitest"

import { createSummarizer } from "../src/summarizer"
import { testModels, textGenerate } from "./mock"

const summary: MemorySummary = {
  user_goal: "Land a staff engineer role",
  resume_focus: ["experience"],
  preferences: ["short bullets"],
  decisions: ["kept the Oslo role"],
  open_tasks: [],
}

function message(
  seq: number,
  role: "user" | "assistant",
  text: string
): ChatMessage {
  return {
    id: `m${seq}`,
    conversationId: "conv-1",
    seq,
    role,
    parts: [{ type: "text", text }],
    agentRunId: null,
    metadata: {},
    createdAt: "2026-09-03T00:00:00.000Z",
  }
}

describe("createSummarizer", () => {
  it("returns the parsed summary and the fast model id", async () => {
    const model = new MockLanguageModelV3({
      modelId: "fast-test",
      doGenerate: [textGenerate(JSON.stringify(summary))],
    })
    const summarizer = createSummarizer(testModels(model))
    const result = await summarizer.summarize({
      previous: null,
      messages: [message(1, "user", "Hi"), message(2, "assistant", "Hello")],
    })
    expect(result).toEqual({ summary, model: "fast-test" })

    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt)
    expect(prompt).toContain("Hi")
    expect(prompt).toContain("Hello")
  })

  it("feeds the previous summary back in", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [textGenerate(JSON.stringify(summary))],
    })
    await createSummarizer(testModels(model)).summarize({
      previous: { ...summary, user_goal: "Earlier goal" },
      messages: [message(1, "user", "Hi")],
    })
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      "Earlier goal"
    )
  })

  it("rejects when the model output does not match the schema", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [textGenerate('{"resume_focus": "not a list"}')],
    })
    await expect(
      createSummarizer(testModels(model)).summarize({
        previous: null,
        messages: [message(1, "user", "Hi")],
      })
    ).rejects.toThrow()
  })
})
