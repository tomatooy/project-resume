import type { UIMessage, UIMessageChunk } from "ai"
import { describe, expect, it } from "vitest"

import { hideToolStepText, visibleParts } from "../src/visible"

function text(value: string): UIMessage["parts"][number] {
  return { type: "text", text: value }
}

const proposal: UIMessage["parts"][number] = {
  type: "tool-propose_patches",
  toolCallId: "c1",
  state: "output-available",
  input: {},
  output: { runId: "run-1", suggestions: [], rejected: [], gaps: [] },
}

describe("visibleParts", () => {
  it("keeps no text from a run that proposed", () => {
    expect(
      visibleParts([
        { type: "step-start" },
        text("Let me think about this."),
        proposal,
        text("On reflection, here is the plan."),
      ])
    ).toEqual([{ type: "step-start" }, proposal])
  })

  it("keeps only the last text part of a run that never proposed", () => {
    expect(
      visibleParts([
        text("First I considered the wording."),
        { type: "step-start" },
        text("Which bullet do you mean?"),
      ])
    ).toEqual([{ type: "step-start" }, text("Which bullet do you mean?")])
  })

  it("leaves a tool-only turn alone", () => {
    expect(visibleParts([{ type: "step-start" }, proposal])).toEqual([
      { type: "step-start" },
      proposal,
    ])
  })
})

describe("hideToolStepText", () => {
  async function through(chunks: UIMessageChunk[]): Promise<UIMessageChunk[]> {
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })
    const out: UIMessageChunk[] = []
    for await (const chunk of stream.pipeThrough(hideToolStepText())) {
      out.push(chunk)
    }
    return out
  }

  const startStep: UIMessageChunk = { type: "start-step" }
  const finishStep: UIMessageChunk = { type: "finish-step" }
  const notes: UIMessageChunk[] = [
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "Let me think." },
    { type: "text-end", id: "t1" },
  ]

  it("drops the text of a step that called a tool", async () => {
    // The shape the SDK emits for a complete tool call: no `tool-input-start`.
    const out = await through([
      startStep,
      ...notes,
      {
        type: "tool-input-available",
        toolCallId: "c1",
        toolName: "propose_patches",
        input: {},
      },
      finishStep,
    ])
    expect(out.map((chunk) => chunk.type)).toEqual([
      "start-step",
      "tool-input-available",
      "finish-step",
    ])
  })

  it("drops the text of a step that streamed its tool input", async () => {
    const out = await through([
      startStep,
      ...notes,
      {
        type: "tool-input-start",
        toolCallId: "c1",
        toolName: "propose_patches",
      },
      finishStep,
    ])
    expect(out.map((chunk) => chunk.type)).toEqual([
      "start-step",
      "tool-input-start",
      "finish-step",
    ])
  })

  it("releases the text of a step that called nothing, after the step ends", async () => {
    const out = await through([startStep, ...notes, finishStep])
    expect(out.map((chunk) => chunk.type)).toEqual([
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "finish-step",
    ])
  })

  it("never passes reasoning through", async () => {
    const out = await through([
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "hmm" },
      { type: "reasoning-end", id: "r1" },
      startStep,
      ...notes,
      finishStep,
    ])
    expect(out.some((chunk) => chunk.type.startsWith("reasoning"))).toBe(false)
  })

  it("releases held text if the stream ends before a finish-step", async () => {
    const out = await through([startStep, ...notes])
    expect(out.map((chunk) => chunk.type)).toEqual([
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
    ])
  })
})
