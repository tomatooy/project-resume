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

/**
 * The `plan` tool's input: one line saying what the turn is about to do. The
 * harness does not require it (nothing safety-relevant hangs off it), but the
 * prompt does, so a turn that skipped planning is visible as a turn with no
 * opening line. Rows written while the input also carried the playbooks the
 * model intended to load still parse: `z.object` strips the unknown key.
 */
export const TurnPlanSchema = z.object({
  summary: z.string().min(1).max(300),
})
export type TurnPlan = z.infer<typeof TurnPlanSchema>

/** `plan`'s output. It echoes the input, because a stored part keeps outputs. */
export const PlanOutputSchema = TurnPlanSchema
export type PlanOutput = TurnPlan

export const ProposedSuggestionSchema = z.object({
  id: z.string(),
  ordinal: z.number().int(),
  patch: ResumePatchSchema,
})
export type ProposedSuggestion = z.infer<typeof ProposedSuggestionSchema>

/** One playbook as `load_skill` returns it. */
export const LoadedSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  body: z.string(),
})
export type LoadedSkill = z.infer<typeof LoadedSkillSchema>

/**
 * `load_skill`'s output. Unknown ids are answered rather than thrown, and
 * `validIds` is the whole library, so a model that guessed still finds its way.
 * `overCap` is the same courtesy for the turn's playbook limit: the ids it
 * refused, so the model learns the ceiling from the tool rather than from a
 * refusal it cannot see.
 *
 * `overCap` carries a default because rows stored before the limit existed
 * still have to parse. The transcript read path drops a part it cannot parse,
 * so a required key here would silently erase the chips of every older turn.
 */
export const LoadSkillOutputSchema = z.object({
  loaded: z.array(LoadedSkillSchema),
  unknown: z.array(z.string()),
  alreadyLoaded: z.array(z.string()),
  overCap: z.array(z.string()).default([]),
  validIds: z.array(z.string()),
})
export type LoadSkillOutput = z.infer<typeof LoadSkillOutputSchema>

/** What `propose_patches` returns, and therefore what a suggestion group renders from. */
export const ProposeOutputSchema = z.object({
  runId: z.string(),
  suggestions: z.array(ProposedSuggestionSchema),
  rejected: z.array(RejectedPatchSchema),
  gaps: z.array(z.string()),
  followUpQuestion: z.string().optional(),
  /**
   * The one sentence the turn shows above its cards. Optional here because a
   * row stored before it existed still has to parse; the tool requires it of
   * the model.
   */
  summary: z.string().optional(),
})
export type ProposeOutput = z.infer<typeof ProposeOutputSchema>

export const MessagePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool-plan"),
    toolCallId: z.string(),
    state: ToolStateSchema,
    output: PlanOutputSchema.optional(),
    errorText: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool-load_skill"),
    toolCallId: z.string(),
    state: ToolStateSchema,
    output: LoadSkillOutputSchema.optional(),
    errorText: z.string().optional(),
  }),
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
  /** The playbooks the turn loaded, for a row that recorded them. */
  skillIds: z.array(z.string()).optional(),
  /** The playbook the composer hinted at. Advisory, kept for the record. */
  hintSkillId: z.string().optional(),
  /** Structural edits were enabled when this turn was sent. */
  structural: z.boolean().optional(),
  /** Tolerated on rows stored before `hintSkillId` replaced it. */
  skillId: z.string().optional(),
  selectedNodeId: z.string().optional(),
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
