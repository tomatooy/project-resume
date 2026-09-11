import {
  type ChatMessage,
  type MessageMetadata,
  type MessagePart,
  MessagePartSchema,
  type NewChatMessage,
} from "@workspace/resume-core"
import { type ModelMessage, type UIMessage, isToolUIPart } from "ai"

import { visibleParts } from "./visible"

type UIPart = UIMessage["parts"][number]

/**
 * Store side of the boundary: whatever the SDK produced, reduced to the parts
 * the domain schema admits, and to what the turn is allowed to show. Tool
 * inputs are dropped on purpose; the output carries everything the UI renders,
 * and the input is the model's draft. `visibleParts` is the same rule the
 * stream applied, so a reload shows what the stream showed.
 */
export function fromUIMessage(
  message: UIMessage,
  base: {
    conversationId: string
    agentRunId: string | null
    metadata?: MessageMetadata
  }
): NewChatMessage {
  const parts: MessagePart[] = []
  for (const part of visibleParts(message.parts)) {
    const candidate = pick(part)
    if (candidate === null) continue
    const parsed = MessagePartSchema.safeParse(candidate)
    if (parsed.success) parts.push(parsed.data)
  }
  return {
    conversationId: base.conversationId,
    role: message.role,
    parts,
    agentRunId: base.agentRunId,
    metadata: base.metadata ?? {},
  }
}

/**
 * The parts the transcript keeps. `find_skills` is absent on purpose: it is a
 * search, its result is the index, and nothing renders it. `plan` and
 * `load_skill` are here because the turn's opening line and its playbook chips
 * have to survive a reload.
 */
const KEPT_TOOL_PARTS = [
  "tool-plan",
  "tool-load_skill",
  "tool-check_fit",
  "tool-propose_patches",
] as const

function isKeptToolPart(part: UIPart): boolean {
  return KEPT_TOOL_PARTS.some((type) => part.type === type)
}

function pick(part: UIPart): unknown {
  if (part.type === "text") {
    return part.text.length > 0 ? { type: "text", text: part.text } : null
  }
  if (isToolUIPart(part) && isKeptToolPart(part)) {
    return {
      type: part.type,
      toolCallId: part.toolCallId,
      state: part.state,
      output: part.output,
      errorText: part.errorText,
    }
  }
  return null
}

/** Render side: a stored message as `useChat` expects to receive it. */
export function toUIMessage(message: ChatMessage): UIMessage {
  return {
    id: message.id,
    role: message.role,
    metadata: message.metadata,
    parts: message.parts.map(toUIPart),
  }
}

/**
 * The store drops tool inputs, but the SDK's message validation requires the
 * key once a call is past streaming, and JSON drops an `undefined` one. An
 * empty object is the input the browser posts back, and is what `useChat`
 * shows for a call it did not watch stream.
 */
function toUIPart(part: MessagePart): UIPart {
  if (part.type === "text") return { type: "text", text: part.text }
  const common = { type: part.type, toolCallId: part.toolCallId }
  switch (part.state) {
    case "input-streaming":
      return { ...common, state: "input-streaming", input: undefined }
    case "input-available":
      return { ...common, state: "input-available", input: {} }
    case "output-available":
      return {
        ...common,
        state: "output-available",
        input: {},
        output: part.output,
      }
    case "output-error":
      return {
        ...common,
        state: "output-error",
        input: undefined,
        errorText: part.errorText ?? "",
      }
  }
}

/**
 * Model side: history as plain text turns. Tool calls are compacted to one
 * line each rather than replayed as call and result pairs, so a run's prompt
 * never depends on how a previous run's tool schema looked and providers get
 * no orphaned tool calls to choke on.
 */
export function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const message of messages) {
    const content = message.parts
      .map(compact)
      .filter((line) => line.length > 0)
      .join("\n")
    if (content.length === 0) continue
    out.push(modelMessage(message.role, content))
  }
  return out
}

function modelMessage(
  role: ChatMessage["role"],
  content: string
): ModelMessage {
  switch (role) {
    case "user":
      return { role: "user", content }
    case "assistant":
      return { role: "assistant", content }
    case "system":
      return { role: "system", content }
  }
}

/**
 * A memory line, not a transcript: enough to know what the turn did and asked,
 * so that dropping the prose does not also drop the model's memory of its own
 * turn. The plan's line is not replayed: it described an intention, and the
 * next turn is answered about what happened.
 */
const MAX_MEMORY_LINE = 400
const MAX_MEMORY_GAPS = 3

function clip(line: string): string {
  if (line.length <= MAX_MEMORY_LINE) return line
  return `${line.slice(0, MAX_MEMORY_LINE - 4).trimEnd()}...`
}

function compact(part: MessagePart): string {
  switch (part.type) {
    case "text":
      return part.text
    case "tool-plan":
    case "tool-load_skill":
      return ""
    case "tool-check_fit": {
      if (part.output) {
        const n = part.output.pageCount
        return `[check_fit: ${n} ${n === 1 ? "page" : "pages"}]`
      }
      return part.errorText ? "[check_fit failed]" : ""
    }
    case "tool-propose_patches": {
      if (!part.output) return part.errorText ? "[propose_patches failed]" : ""
      const { suggestions, rejected, summary, gaps, followUpQuestion } =
        part.output
      const kept = suggestions.length
      const counts = `proposed ${kept} ${kept === 1 ? "patch" : "patches"}`
      const head =
        rejected.length > 0
          ? `${counts}, ${rejected.length} rejected.`
          : `${counts}.`
      const tail = [
        summary ?? "",
        gaps.length > 0
          ? `Missing: ${gaps.slice(0, MAX_MEMORY_GAPS).join("; ")}.`
          : "",
        followUpQuestion ? `Asked: ${followUpQuestion}` : "",
      ].filter((piece) => piece.length > 0)
      return clip(`[${head}${tail.length > 0 ? ` ${tail.join(" ")}` : ""}]`)
    }
  }
}
