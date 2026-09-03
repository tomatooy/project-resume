import type { ChatMessage } from "@workspace/resume-core"
import type { UIMessage } from "ai"
import { describe, expect, it } from "vitest"

import { fromUIMessage, toModelMessages, toUIMessage } from "../src/messages"
import { fixture, rewrite } from "./mock"

const { bullet } = fixture()
const patch = rewrite(bullet, "Shipped it.")

const proposeOutput = {
  runId: "run-1",
  suggestions: [{ id: "s0", ordinal: 0, patch }],
  rejected: [],
  gaps: [],
}

describe("fromUIMessage", () => {
  it("keeps text and known tool parts and drops everything else", () => {
    const ui: UIMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "reasoning", text: "thinking" },
        { type: "text", text: "Here you go.", state: "done" },
        {
          type: "tool-check_fit",
          toolCallId: "c1",
          state: "output-available",
          input: { patches: [] },
          output: { pageCount: 2, pageSize: "A4" },
        },
        {
          type: "tool-propose_patches",
          toolCallId: "c2",
          state: "output-available",
          input: { patches: [patch] },
          output: proposeOutput,
        },
        { type: "file", mediaType: "image/png", url: "data:," },
      ],
    }
    const stored = fromUIMessage(ui, {
      conversationId: "conv-1",
      agentRunId: "run-1",
      metadata: { skillId: "bullet_rewrite" },
    })
    expect(stored).toEqual({
      conversationId: "conv-1",
      role: "assistant",
      agentRunId: "run-1",
      metadata: { skillId: "bullet_rewrite" },
      parts: [
        { type: "text", text: "Here you go." },
        {
          type: "tool-check_fit",
          toolCallId: "c1",
          state: "output-available",
          output: { pageCount: 2, pageSize: "A4" },
        },
        {
          type: "tool-propose_patches",
          toolCallId: "c2",
          state: "output-available",
          output: proposeOutput,
        },
      ],
    })
  })

  it("keeps a failed tool call with its error text", () => {
    const ui: UIMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        {
          type: "tool-propose_patches",
          toolCallId: "c2",
          state: "output-error",
          input: {},
          errorText: "boom",
        },
      ],
    }
    const stored = fromUIMessage(ui, { conversationId: "c", agentRunId: null })
    expect(stored.parts).toEqual([
      {
        type: "tool-propose_patches",
        toolCallId: "c2",
        state: "output-error",
        errorText: "boom",
      },
    ])
  })

  it("drops empty text parts", () => {
    const ui: UIMessage = {
      id: "m1",
      role: "user",
      parts: [{ type: "text", text: "" }],
    }
    const stored = fromUIMessage(ui, { conversationId: "c", agentRunId: null })
    expect(stored.parts).toEqual([])
  })
})

describe("toUIMessage", () => {
  it("round trips a stored message into a renderable one", () => {
    const stored: ChatMessage = {
      id: "m1",
      conversationId: "conv-1",
      seq: 3,
      role: "assistant",
      agentRunId: "run-1",
      metadata: { skillId: "bullet_rewrite" },
      createdAt: "2026-09-03T00:00:00.000Z",
      parts: [
        { type: "text", text: "Here you go." },
        {
          type: "tool-propose_patches",
          toolCallId: "c2",
          state: "output-available",
          output: proposeOutput,
        },
      ],
    }
    const ui = toUIMessage(stored)
    expect(ui.id).toBe("m1")
    expect(ui.role).toBe("assistant")
    expect(ui.metadata).toEqual({ skillId: "bullet_rewrite" })
    expect(ui.parts).toHaveLength(2)
    expect(ui.parts[1]).toMatchObject({
      type: "tool-propose_patches",
      toolCallId: "c2",
      state: "output-available",
      output: proposeOutput,
    })
    // And back again without loss.
    expect(
      fromUIMessage(ui, {
        conversationId: "conv-1",
        agentRunId: "run-1",
        metadata: stored.metadata,
      }).parts
    ).toEqual(stored.parts)
  })
})

describe("toModelMessages", () => {
  const base = {
    conversationId: "conv-1",
    agentRunId: null,
    metadata: {},
    createdAt: "2026-09-03T00:00:00.000Z",
  }

  it("compacts tool parts to short markers and drops empty messages", () => {
    const messages: ChatMessage[] = [
      {
        ...base,
        id: "m1",
        seq: 1,
        role: "user",
        parts: [{ type: "text", text: "Fit this on one page" }],
      },
      {
        ...base,
        id: "m2",
        seq: 2,
        role: "assistant",
        parts: [
          {
            type: "tool-check_fit",
            toolCallId: "c1",
            state: "output-available",
            output: { pageCount: 2, pageSize: "A4" },
          },
          { type: "text", text: "Two pages now, trimming." },
          {
            type: "tool-propose_patches",
            toolCallId: "c2",
            state: "output-available",
            output: {
              ...proposeOutput,
              rejected: [
                { index: 1, code: "UNGROUNDED_NUMBER", message: "no" },
              ],
            },
          },
        ],
      },
      { ...base, id: "m3", seq: 3, role: "assistant", parts: [] },
    ]
    expect(toModelMessages(messages)).toEqual([
      { role: "user", content: "Fit this on one page" },
      {
        role: "assistant",
        content:
          "[check_fit: 2 pages]\nTwo pages now, trimming.\n[proposed 1 patch, 1 rejected]",
      },
    ])
  })
})
