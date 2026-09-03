import {
  PATCH_ERROR_CODES,
  PageSizeSchema,
  ResumePatchSchema,
} from "@workspace/resume-schema"
import { z } from "zod"

/**
 * The stored shape of a conversation message.
 *
 * This is a whitelist of the AI SDK message parts the app knows how to render
 * and replay, defined here rather than borrowed from the SDK so the domain
 * has no dependency on it. Anything else the model emits (reasoning, step
 * markers, provider extras) is dropped on store, which is also what keeps a
 * provider swap from leaking new part types into the history.
 */

export const MessageRoleSchema = z.enum(["user", "assistant", "system"])
export type MessageRole = z.infer<typeof MessageRoleSchema>

const ToolStateSchema = z.enum([
  "input-streaming",
  "input-available",
  "output-available",
  "output-error",
])
export type ToolState = z.infer<typeof ToolStateSchema>

export const CheckFitOutputSchema = z.object({
  pageCount: z.number().int().min(1),
  pageSize: PageSizeSchema,
})
export type CheckFitOutput = z.infer<typeof CheckFitOutputSchema>

export const RejectedPatchSchema = z.object({
  index: z.number().int(),
  code: z.enum(PATCH_ERROR_CODES),
  message: z.string(),
})

export const ProposedSuggestionSchema = z.object({
  id: z.string(),
  ordinal: z.number().int(),
  patch: ResumePatchSchema,
})
export type ProposedSuggestion = z.infer<typeof ProposedSuggestionSchema>

/** What `propose_patches` returns, and therefore what a suggestion group renders from. */
export const ProposeOutputSchema = z.object({
  runId: z.string(),
  suggestions: z.array(ProposedSuggestionSchema),
  rejected: z.array(RejectedPatchSchema),
  gaps: z.array(z.string()),
  followUpQuestion: z.string().optional(),
})
export type ProposeOutput = z.infer<typeof ProposeOutputSchema>

export const MessagePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool-check_fit"),
    toolCallId: z.string(),
    state: ToolStateSchema,
    output: CheckFitOutputSchema.optional(),
    errorText: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool-propose_patches"),
    toolCallId: z.string(),
    state: ToolStateSchema,
    output: ProposeOutputSchema.optional(),
    errorText: z.string().optional(),
  }),
])
export type MessagePart = z.infer<typeof MessagePartSchema>

export const MessageMetadataSchema = z.object({
  skillId: z.string().optional(),
  selectedNodeId: z.string().optional(),
  /** The page target the run was given, so a fit chip can say "over". */
  targetPages: z.number().int().min(1).max(4).optional(),
  /** The user pressed Stop; the assistant text is whatever had streamed. */
  stopped: z.boolean().optional(),
})
export type MessageMetadata = z.infer<typeof MessageMetadataSchema>

export type ChatMessage = {
  id: string
  conversationId: string
  /** Assigned by the database; the only ordering the memory layer trusts. */
  seq: number
  role: MessageRole
  parts: MessagePart[]
  agentRunId: string | null
  metadata: MessageMetadata
  createdAt: string
}

export type NewChatMessage = Omit<ChatMessage, "id" | "seq" | "createdAt">
