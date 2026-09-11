import type { ChatMessage } from "@workspace/resume-core"
import { type UIMessage, validateUIMessages } from "ai"
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
  summary: "Tightened the selected bullet.",
}

describe("fromUIMessage", () => {
  it("keeps text and known tool parts and drops everything else", () => {
    const ui: UIMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "reasoning", text: "thinking" },
        {
          type: "tool-check_fit",
          toolCallId: "c1",
          state: "output-available",
          input: { patches: [] },
          output: { pageCount: 2, pageSize: "A4" },
        },
        { type: "file", mediaType: "image/png", url: "data:," },
      ],
    }
    const stored = fromUIMessage(ui, {
      conversationId: "conv-1",
      agentRunId: "run-1",
      metadata: { hintSkillId: "bullet_rewrite", structural: true },
    })
    expect(stored).toEqual({
      conversationId: "conv-1",
      role: "assistant",
      agentRunId: "run-1",
      metadata: { hintSkillId: "bullet_rewrite", structural: true },
      parts: [
        {
          type: "tool-check_fit",
          toolCallId: "c1",
          state: "output-available",
          output: { pageCount: 2, pageSize: "A4" },
        },
      ],
    })
  })

  it("keeps no text from a run that proposed", () => {
    // The store applies the same rule the stream did, so a reload cannot show
    // a paragraph the panel never showed.
    const ui: UIMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "text", text: "Let me think about this." },
        {
          type: "tool-propose_patches",
          toolCallId: "c2",
          state: "output-available",
          input: { patches: [patch] },
          output: proposeOutput,
        },
        { type: "text", text: "On reflection, here is the plan." },
      ],
    }
    const stored = fromUIMessage(ui, { conversationId: "c", agentRunId: null })
    expect(stored.parts).toEqual([
      {
        type: "tool-propose_patches",
        toolCallId: "c2",
        state: "output-available",
        output: proposeOutput,
      },
    ])
  })

  it("keeps the last text part of a run that never proposed", () => {
    const ui: UIMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "text", text: "First I considered the wording." },
        { type: "step-start" },
        { type: "text", text: "Which bullet do you mean?" },
      ],
    }
    const stored = fromUIMessage(ui, { conversationId: "c", agentRunId: null })
    // `step-start` is not a stored part type; only the answer survives.
    expect(stored.parts).toEqual([
      { type: "text", text: "Which bullet do you mean?" },
    ])
  })

  it("keeps the plan and playbook parts a reload has to render", () => {
    const ui: UIMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        {
          type: "tool-plan",
          toolCallId: "c1",
          state: "output-available",
          input: { summary: "Tightening the Acme bullets." },
          output: { summary: "Tightening the Acme bullets." },
        },
        {
          type: "tool-load_skill",
          toolCallId: "c2",
          state: "output-available",
          input: { ids: ["bullet_rewrite"] },
          output: {
            loaded: [
              { id: "bullet_rewrite", name: "Impact bullets", body: "..." },
            ],
            unknown: [],
            alreadyLoaded: [],
            validIds: ["bullet_rewrite"],
          },
        },
      ],
    }
    const stored = fromUIMessage(ui, { conversationId: "c", agentRunId: null })
    expect(stored.parts.map((part) => part.type)).toEqual([
      "tool-plan",
      "tool-load_skill",
    ])
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
      metadata: { hintSkillId: "bullet_rewrite" },
      createdAt: "2026-09-03T00:00:00.000Z",
      parts: [
        { type: "text", text: "Here you go." },
        {
          type: "tool-check_fit",
          toolCallId: "c2",
          state: "output-available",
          output: { pageCount: 1, pageSize: "LETTER" },
        },
      ],
    }
    const ui = toUIMessage(stored)
    expect(ui.id).toBe("m1")
    expect(ui.role).toBe("assistant")
    expect(ui.metadata).toEqual({ hintSkillId: "bullet_rewrite" })
    expect(ui.parts).toHaveLength(2)
    expect(ui.parts[1]).toMatchObject({
      type: "tool-check_fit",
      toolCallId: "c2",
      state: "output-available",
      output: { pageCount: 1, pageSize: "LETTER" },
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

  it("survives the SDK's message validation after a JSON round trip", async () => {
    // The browser posts the previous assistant message back with its next
    // turn. The SDK requires `input` on tool parts past the streaming state,
    // and JSON drops an `undefined` one, which is what the GET route did.
    const parts: ChatMessage["parts"] = [
      { type: "text", text: "Here you go." },
      {
        type: "tool-plan",
        toolCallId: "c0",
        state: "output-available",
        output: { summary: "Tightening." },
      },
      {
        type: "tool-load_skill",
        toolCallId: "c6",
        state: "output-available",
        output: {
          loaded: [],
          unknown: [],
          alreadyLoaded: ["bullet_rewrite"],
          overCap: [],
          validIds: ["bullet_rewrite"],
        },
      },
      {
        type: "tool-propose_patches",
        toolCallId: "c1",
        state: "input-available",
      },
      {
        type: "tool-propose_patches",
        toolCallId: "c2",
        state: "output-available",
        output: proposeOutput,
      },
      {
        type: "tool-check_fit",
        toolCallId: "c3",
        state: "output-available",
        output: { pageCount: 1, pageSize: "LETTER" },
      },
      {
        type: "tool-check_fit",
        toolCallId: "c4",
        state: "output-error",
        errorText: "no",
      },
      { type: "tool-check_fit", toolCallId: "c5", state: "input-streaming" },
    ]
    const stored: ChatMessage = {
      id: "m1",
      conversationId: "conv-1",
      seq: 3,
      role: "assistant",
      agentRunId: "run-1",
      metadata: {},
      createdAt: "2026-09-03T00:00:00.000Z",
      parts,
    }
    const posted: unknown[] = JSON.parse(
      JSON.stringify([
        toUIMessage(stored),
        { id: "u1", role: "user", parts: [{ type: "text", text: "More" }] },
      ])
    )
    await expect(
      validateUIMessages({ messages: posted })
    ).resolves.toHaveLength(2)
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
            type: "tool-plan",
            toolCallId: "c0",
            state: "output-available",
            output: { summary: "Trimming to one page." },
          },
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
              rejected: [{ index: 1, code: "OUT_OF_SCOPE", message: "no" }],
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
          "[check_fit: 2 pages]\nTwo pages now, trimming.\n[proposed 1 patch, 1 rejected. Tightened the selected bullet.]",
      },
    ])
  })

  it("keeps the summary, the gaps and the question the model will be answered on", () => {
    const messages: ChatMessage[] = [
      {
        ...base,
        id: "m1",
        seq: 1,
        role: "assistant",
        parts: [
          {
            type: "tool-propose_patches",
            toolCallId: "c1",
            state: "output-available",
            output: {
              ...proposeOutput,
              summary:
                "Rewrote the PitchGhost bullets to lead with the scraper engine.",
              gaps: ["team size", "deploy frequency", "budget"],
              followUpQuestion:
                "What was the deploy frequency before and after?",
            },
          },
        ],
      },
    ]
    expect(toModelMessages(messages)).toEqual([
      {
        role: "assistant",
        content:
          "[proposed 1 patch. Rewrote the PitchGhost bullets to lead with the scraper engine. Missing: team size; deploy frequency; budget. Asked: What was the deploy frequency before and after?]",
      },
    ])
  })

  it("drops gaps past the third", () => {
    const messages: ChatMessage[] = [
      {
        ...base,
        id: "m1",
        seq: 1,
        role: "assistant",
        parts: [
          {
            type: "tool-propose_patches",
            toolCallId: "c1",
            state: "output-available",
            output: {
              ...proposeOutput,
              gaps: ["one", "two", "three", "four"],
            },
          },
        ],
      },
    ]
    const [message] = toModelMessages(messages)
    const content = typeof message?.content === "string" ? message.content : ""
    expect(content).toContain("Missing: one; two; three.")
    expect(content).not.toContain("four")
  })

  it("clips a line that runs long", () => {
    const messages: ChatMessage[] = [
      {
        ...base,
        id: "m1",
        seq: 1,
        role: "assistant",
        parts: [
          {
            type: "tool-propose_patches",
            toolCallId: "c1",
            state: "output-available",
            output: { ...proposeOutput, summary: "x".repeat(600) },
          },
        ],
      },
    ]
    const [message] = toModelMessages(messages)
    const content = typeof message?.content === "string" ? message.content : ""
    expect(content.length).toBeLessThanOrEqual(400)
    expect(content.endsWith("...")).toBe(true)
  })

  it("still compacts a stored row that has no summary", () => {
    const messages: ChatMessage[] = [
      {
        ...base,
        id: "m1",
        seq: 1,
        role: "assistant",
        parts: [
          {
            type: "tool-propose_patches",
            toolCallId: "c1",
            state: "output-available",
            output: {
              runId: "run-1",
              suggestions: [],
              rejected: [],
              gaps: [],
            },
          },
        ],
      },
    ]
    expect(toModelMessages(messages)).toEqual([
      { role: "assistant", content: "[proposed 0 patches.]" },
    ])
  })
})
