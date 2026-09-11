import { isToolUIPart, type UIMessage, type UIMessageChunk } from "ai"

type UIPart = UIMessage["parts"][number]

/**
 * What a turn is allowed to show.
 *
 * A run that proposed even once keeps no text at all: its user-facing content
 * is the proposal's `summary`, `gaps` and `followUpQuestion`, and prose on the
 * way to a tool call is deliberation. A run that never proposed keeps its last
 * text part, so a refusal, a question or a step-budget exhaustion still
 * answers the user rather than rendering an empty turn.
 */
export function visibleParts(parts: UIPart[]): UIPart[] {
  const proposed = parts.some(
    (part) => isToolUIPart(part) && part.type === "tool-propose_patches"
  )
  if (proposed) return parts.filter((part) => part.type !== "text")

  const lastText = parts.reduce(
    (index, part, i) => (part.type === "text" ? i : index),
    -1
  )
  return parts.filter((part, i) => part.type !== "text" || i === lastText)
}

/**
 * The same rule on the wire.
 *
 * Text is held until its step ends, because only the step's end says whether a
 * tool call followed. Holding is what keeps the panel from showing a paragraph
 * and then deleting it when the call lands; the cost is that a step's last
 * paragraph arrives whole at `finish-step` instead of typing out. Reasoning is
 * dropped here too, so the private channel never reaches the browser even if a
 * call site forgets `sendReasoning: false`.
 */
export function hideToolStepText(): TransformStream<
  UIMessageChunk,
  UIMessageChunk
> {
  let held: UIMessageChunk[] = []
  let called = false

  function release(
    controller: TransformStreamDefaultController<UIMessageChunk>
  ): void {
    for (const chunk of held) controller.enqueue(chunk)
    held = []
  }

  return new TransformStream({
    transform(chunk, controller) {
      switch (chunk.type) {
        case "start-step":
          held = []
          called = false
          controller.enqueue(chunk)
          return
        case "text-start":
        case "text-delta":
        case "text-end":
          held.push(chunk)
          return
        case "reasoning-start":
        case "reasoning-delta":
        case "reasoning-end":
        case "reasoning-file":
          return
        case "finish-step":
          if (!called) release(controller)
          held = []
          controller.enqueue(chunk)
          return
        default:
          // Any tool chunk means this step called a tool. Matching the whole
          // family rather than `tool-input-start` alone is what makes the rule
          // hold: a provider that sends a complete call emits
          // `tool-input-available` with no start chunks.
          if (chunk.type.startsWith("tool-")) called = true
          controller.enqueue(chunk)
      }
    },
    flush(controller) {
      if (!called) release(controller)
    },
  })
}
