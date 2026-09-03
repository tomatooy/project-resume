import {
  type ChatMessage,
  type MessageMetadata,
  type MessagePart,
  MessagePartSchema,
  type NewChatMessage,
} from "@workspace/resume-core"
import { type ModelMessage, type UIMessage, isToolUIPart } from "ai"

type UIPart = UIMessage["parts"][number]

/**
 * Store side of the boundary: whatever the SDK produced, reduced to the parts
 * the domain schema admits. Tool inputs are dropped on purpose; the output
 * carries everything the UI renders, and the input is the model's draft.
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
  for (const part of message.parts) {
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

function pick(part: UIPart): unknown {
  if (part.type === "text") {
    return part.text.length > 0 ? { type: "text", text: part.text } : null
  }
  if (
    isToolUIPart(part) &&
    (part.type === "tool-check_fit" || part.type === "tool-propose_patches")
  ) {
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

function toUIPart(part: MessagePart): UIPart {
  if (part.type === "text") return { type: "text", text: part.text }
  const common = { type: part.type, toolCallId: part.toolCallId }
  switch (part.state) {
    case "input-streaming":
      return { ...common, state: "input-streaming", input: undefined }
    case "input-available":
      return { ...common, state: "input-available", input: undefined }
    case "output-available":
      return {
        ...common,
        state: "output-available",
        input: undefined,
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

function compact(part: MessagePart): string {
  switch (part.type) {
    case "text":
      return part.text
    case "tool-check_fit": {
      if (part.output) {
        const n = part.output.pageCount
        return `[check_fit: ${n} ${n === 1 ? "page" : "pages"}]`
      }
      return part.errorText ? "[check_fit failed]" : ""
    }
    case "tool-propose_patches": {
      if (!part.output) return part.errorText ? "[propose_patches failed]" : ""
      const kept = part.output.suggestions.length
      const rejected = part.output.rejected.length
      const head = `[proposed ${kept} ${kept === 1 ? "patch" : "patches"}`
      return rejected > 0 ? `${head}, ${rejected} rejected]` : `${head}]`
    }
  }
}
