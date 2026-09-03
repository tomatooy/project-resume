import { useChat } from "@ai-sdk/react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { ResumePatchSchema, type ResumePatch } from "@workspace/resume-schema"
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai"
import { useCallback, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { apiErrorFromBody, decideSuggestions } from "@/lib/api"
import { qk } from "@/lib/query-keys"
import type { ChatUIMessage, SkillId, SuggestionStatus } from "@/lib/types"
import { useResumeState, useSession } from "../resume/session-context"

export type SendOptions = {
  skillId: SkillId
  selectedNodeId: string | null
  jobDescription?: string
  targetPages?: number
}

/**
 * The panel's side of `/api/chat`.
 *
 * `useChat` owns the transcript and the stream; this wraps it with the three
 * things the route and the editor need around it: the skill inputs travel in
 * the request body, a `check_fit` call is answered by rendering the document
 * here in the browser, and suggestion statuses are kept beside the messages
 * because a card's patch is in the transcript but its decision is not.
 */
export function useAssistant({
  conversationId,
  resumeId,
  initialMessages,
  initialStatuses,
}: {
  conversationId: string
  resumeId: string
  initialMessages: ChatUIMessage[]
  initialStatuses: Record<string, SuggestionStatus>
}) {
  const session = useSession()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const doc = useResumeState((s) => s.doc)
  const templateId = useResumeState((s) => s.templateId)
  const templateOptions = useResumeState((s) => s.templateOptions)

  const [statuses, setStatuses] =
    useState<Record<string, SuggestionStatus>>(initialStatuses)
  const [deciding, setDeciding] = useState(false)

  // Read inside callbacks that outlive a render: the document the fit check
  // measures must be the one on screen when the model asks, not when the
  // message was sent.
  const latest = useRef({ doc, templateId, templateOptions })
  latest.current = { doc, templateId, templateOptions }
  // The last turn's inputs, re-sent with a `check_fit` answer so the route
  // sees one request shape whichever half of the turn it is handling.
  const lastSend = useRef<SendOptions | null>(null)

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: "/api/chat",
        credentials: "same-origin",
        body: { conversationId, resumeId },
        // The server keeps the transcript; it only needs the turn being
        // answered and the message before it (a paused fit check to close).
        prepareSendMessagesRequest: ({ id, messages, body, trigger }) => ({
          body: { id, trigger, messages: messages.slice(-2), ...body },
        }),
      }),
    [conversationId, resumeId]
  )

  const chat = useChat<ChatUIMessage>({
    id: conversationId,
    messages: initialMessages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: ({ toolCall }) => {
      if (toolCall.dynamic || toolCall.toolName !== "check_fit") return
      // Not awaited: the SDK documents that awaiting here deadlocks the
      // stream. The answer arrives through `addToolOutput` when it is ready.
      void measure(toolCall.toolCallId, toolCall.input.patches)
    },
    onError: (error) => {
      const apiError = apiErrorFromBody(error.message, 0)
      if (apiError.code === "UNAUTHENTICATED") {
        void navigate({
          to: "/login",
          search: { next: window.location.pathname },
        })
        return
      }
      toast.error(
        apiError.code === "INTERNAL" &&
          error.message &&
          !error.message.startsWith("{")
          ? error.message
          : apiError.message
      )
    },
  })

  async function measure(toolCallId: string, drafts: unknown[]) {
    // Imported here rather than at the top of the file because pdf.js touches
    // DOMMatrix on load, which does not exist while the panel is being
    // server-rendered. The same reason PdfViewer is lazy.
    const { checkFit } = await import("../resume/preview/check-fit")
    const skillId = lastSend.current?.skillId ?? "condense_to_pages"
    const patches: ResumePatch[] = []
    for (const draft of drafts) {
      // Drafts carry no skill tag yet; the server stamps it on the final
      // proposal. Malformed drafts are skipped rather than failing the count.
      const stamped =
        typeof draft === "object" && draft !== null
          ? { skillId, ...draft }
          : draft
      const parsed = ResumePatchSchema.safeParse(stamped)
      if (parsed.success) patches.push(parsed.data)
    }
    const { doc, templateId, templateOptions } = latest.current
    const result = await checkFit({
      resume: doc,
      templateId,
      options: templateOptions,
      patches,
    })
    const options = { body: bodyOf(lastSend.current) }
    if (result.ok) {
      await chat.addToolOutput({
        tool: "check_fit",
        toolCallId,
        output: { pageCount: result.pageCount, pageSize: result.pageSize },
        options,
      })
    } else {
      await chat.addToolOutput({
        tool: "check_fit",
        toolCallId,
        state: "output-error",
        errorText: result.message,
        options,
      })
    }
  }

  const send = useCallback(
    (text: string, options: SendOptions) => {
      lastSend.current = options
      void chat.sendMessage({ text }, { body: bodyOf(options) })
    },
    [chat.sendMessage]
  )

  const retry = useCallback(() => {
    void chat.regenerate({ body: bodyOf(lastSend.current) })
  }, [chat.regenerate])

  const decide = useCallback(
    async (ids: string[], status: "accepted" | "rejected", runId: string) => {
      if (ids.length === 0) return
      setDeciding(true)
      session.previewPatches([])
      try {
        const result = await decideSuggestions({
          runId,
          decisions: ids.map((suggestionId) => ({ suggestionId, status })),
        })
        session.replaceHead(result.head, result.revision, result.updatedAt)
        setStatuses((prev) => {
          const next = { ...prev }
          for (const outcome of result.results) {
            next[outcome.suggestionId] = outcome.status
          }
          return next
        })
        if (result.version) {
          await queryClient.invalidateQueries({
            queryKey: qk.versions(resumeId),
          })
        }
        const stale = result.results.filter((r) => r.status === "stale").length
        if (stale > 0) {
          toast.warning(
            `${stale} ${stale === 1 ? "suggestion" : "suggestions"} no longer matched the text`
          )
        }
      } finally {
        setDeciding(false)
      }
    },
    [session, queryClient, resumeId]
  )

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    statuses,
    deciding,
    send,
    stop: chat.stop,
    retry,
    decide,
  }
}

function bodyOf(options: SendOptions | null): Record<string, unknown> {
  if (!options) return {}
  return {
    skillId: options.skillId,
    selectedNodeId: options.selectedNodeId,
    jobDescription: options.jobDescription,
    targetPages: options.targetPages,
  }
}
