import type { AgentTools } from "@workspace/agent"
import type { MessageMetadata, SuggestionStatus } from "@workspace/resume-core"
import type { InferUITools, UIDataTypes, UIMessage } from "ai"
import { z } from "zod"

/**
 * The wire contract of `/api/chat`, shared by the route and the browser.
 *
 * The route parses what arrives with these schemas; the panel builds what it
 * sends from these types. A field added to one side without the other is a
 * type error, not a request that silently loses a value.
 */

/**
 * What `useChat` posts: its own envelope plus the fields the panel adds. The
 * turn inputs travel with every request, but only a new turn reads them; a
 * continuation takes them from the run it belongs to.
 */
export const ChatRequestSchema = z.object({
  id: z.string().optional(),
  trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
  messages: z.array(z.unknown()).min(1),
  conversationId: z.uuid(),
  resumeId: z.uuid(),
  /** The composer's hint. Advisory: the model may ignore it. */
  hintSkillId: z.string().optional(),
  selectedNodeId: z.string().nullable().optional(),
  /** The user enabled removing and restructuring for this turn. */
  structural: z.boolean().optional(),
})
export type ChatRequest = z.infer<typeof ChatRequestSchema>

/** The per-turn fields the panel adds to the transport's own body. */
export type ChatTurnInputs = Pick<
  ChatRequest,
  "hintSkillId" | "selectedNodeId" | "structural"
>

/** What the GET reads from the query string. */
export const HistoryQuerySchema = z.object({
  conversationId: z.uuid(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

/**
 * A conversation message as `useChat` holds it: the assistant's tool parts
 * are typed from the same tool definitions the server streams from, so a
 * `tool-propose_patches` part's output is a `ProposeOutput` here too.
 */
export type ChatUIMessage = UIMessage<
  MessageMetadata,
  UIDataTypes,
  InferUITools<AgentTools>
>

/**
 * What the GET answers: the transcript plus card statuses. The server builds
 * it from stored rows as plain `UIMessage`s; the browser reads the same JSON
 * under the tool-typed message.
 */
export type ChatHistory<TMessage extends UIMessage = ChatUIMessage> = {
  messages: TMessage[]
  /** Status by suggestion id, for every card in `messages`. */
  suggestions: Record<string, SuggestionStatus>
}
