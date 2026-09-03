import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from "@ai-sdk/provider"
import {
  indexNodes,
  type Resume,
  type ResumePatch,
} from "@workspace/resume-schema"
import { onePage } from "@workspace/resume-schema/fixtures"
import { simulateReadableStream } from "ai"
import type { MockLanguageModelV3 } from "ai/test"

import type { Models } from "../src/models"

export const usage: LanguageModelV3Usage = {
  inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 30, text: 30, reasoning: 0 },
}

/** One model turn that calls a tool and stops. */
export function toolCallStream(
  toolName: string,
  input: unknown,
  toolCallId = "call-1"
): LanguageModelV3StreamResult {
  const chunks: LanguageModelV3StreamPart[] = [
    { type: "stream-start", warnings: [] },
    {
      type: "tool-call",
      toolCallId,
      toolName,
      input: JSON.stringify(input),
    },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: undefined },
      usage,
    },
  ]
  return { stream: simulateReadableStream({ chunks }) }
}

/** One model turn that answers in plain text and stops. */
export function textStream(text: string): LanguageModelV3StreamResult {
  const chunks: LanguageModelV3StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: undefined },
      usage,
    },
  ]
  return { stream: simulateReadableStream({ chunks }) }
}

export function textGenerate(text: string): LanguageModelV3GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: undefined },
    usage,
    warnings: [],
  }
}

export function testModels(model: MockLanguageModelV3): Models {
  return {
    smart: model,
    fast: model,
    ids: { smart: model.modelId, fast: model.modelId },
    providerOptions: {},
  }
}

export type Fixture = {
  resume: Resume
  /** First bullet of the first experience item. */
  bullet: { id: string; text: string; itemId: string }
  /** A bullet in a different item, for scope checks. */
  otherBullet: { id: string; text: string }
}

export function fixture(): Fixture {
  const resume = onePage
  const bullets: { id: string; text: string; itemId: string }[] = []
  for (const ref of indexNodes(resume).values()) {
    if (ref.kind !== "bullet" || !ref.parentId) continue
    const node = ref.node
    if (
      typeof node === "object" &&
      node !== null &&
      "id" in node &&
      "text" in node &&
      typeof node.id === "string" &&
      typeof node.text === "string"
    ) {
      bullets.push({ id: node.id, text: node.text, itemId: ref.parentId })
    }
  }
  const first = bullets[0]
  const other = bullets.find((b) => b.itemId !== first?.itemId)
  if (!first || !other) throw new Error("fixture needs bullets in two items")
  return { resume, bullet: first, otherBullet: other }
}

export function rewrite(
  bullet: { id: string; text: string },
  after: string
): ResumePatch {
  return {
    op: "replace_text",
    skillId: "bullet_rewrite",
    targetNodeId: bullet.id,
    field: "text",
    before: bullet.text,
    after,
    reason: "Leads with the outcome.",
  }
}
