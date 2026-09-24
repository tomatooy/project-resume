import { Chat } from "@ai-sdk/react"
import { Store } from "@tanstack/store"
import { ResumePatchSchema, type ResumePatch } from "@workspace/resume-schema"
import { DefaultChatTransport, type ChatTransport } from "ai"

import * as api from "@/lib/api"
import type {
  ChatHistory,
  ChatTurnInputs,
  ChatUIMessage,
  SuggestionStatus,
} from "@/lib/types"
import type { ResumeSession } from "../resume/store"

export type SendOptions = {
  hintSkillId?: string
  selectedNodeId: string | null
  structural?: boolean
}
export type AssistantApi = Pick<
  typeof api,
  "cancelChatRun" | "decideSuggestions" | "clearConversation"
>
type AssistantState = {
  statuses: Record<string, SuggestionStatus>
  deciding: boolean
  clearing: boolean
  running: boolean
  unread: boolean
  draft: string
  hintSkillId: string | undefined
  structural: boolean
}

type RuntimeOptions = {
  onError: (error: Error) => void
  onChanged: () => void
  isActive: () => boolean
  measure?: typeof import("../resume/preview/check-fit").checkFit
  api?: AssistantApi
  transport?: ChatTransport<ChatUIMessage>
}

/** One transport and one set of callbacks per resume, independent of panels. */
export class AssistantRuntime {
  readonly chat: Chat<ChatUIMessage>
  readonly store: Store<AssistantState>
  private readonly api: AssistantApi
  private epoch = 0
  private stopped = false
  private lastSend: SendOptions | null = null
  private pending: Promise<void> | null = null
  private decision: Promise<void> | null = null
  private clearing: Promise<void> | null = null
  private runId: string | null = null
  private priorMessageId: string | undefined

  constructor(
    readonly session: ResumeSession,
    history: ChatHistory,
    private readonly options: RuntimeOptions
  ) {
    this.api = options.api ?? api
    this.store = new Store<AssistantState>({
      statuses: history.suggestions,
      deciding: false,
      clearing: false,
      running: false,
      unread: false,
      draft: "",
      hintSkillId: undefined,
      structural: false,
    })
    const { conversationId, resumeId } = session.state
    this.chat = new Chat<ChatUIMessage>({
      id: conversationId,
      messages: history.messages,
      transport:
        options.transport ??
        new DefaultChatTransport({
          api: "/api/chat",
          credentials: "same-origin",
          body: { conversationId, resumeId },
          prepareSendMessagesRequest: ({ id, messages, body, trigger }) => ({
            body: { id, trigger, messages: messages.slice(-2), ...body },
          }),
        }),
      sendAutomaticallyWhen: (input) =>
        !this.stopped && checkFitAnswered(input),
      onToolCall: ({ toolCall }) => {
        if (
          toolCall.dynamic ||
          toolCall.toolName !== "check_fit" ||
          this.stopped
        )
          return
        void this.measure(
          toolCall.toolCallId,
          toolCall.input.patches,
          this.epoch
        ).catch((error: Error) => options.onError(error))
      },
      onFinish: ({ message }) => {
        if (message.metadata?.runId) this.runId = message.metadata.runId
        if (
          this.stopped ||
          awaitingFit(message) ||
          checkFitAnswered({ messages: [message] })
        )
          return
        this.patch({ running: false, unread: !options.isActive() })
        options.onChanged()
      },
      onError: (error) => {
        this.patch({ running: false })
        const parsed = api.apiErrorFromBody(error.message, 0)
        options.onError(
          parsed.code === "INTERNAL" && !error.message.startsWith("{")
            ? error
            : parsed
        )
      },
    })
  }

  patch(next: Partial<AssistantState>): void {
    this.store.setState((s) => ({ ...s, ...next }))
  }

  send = (text: string, options: SendOptions): void => {
    this.startTurn(options, text)
  }

  retry = (override?: Partial<SendOptions>): void => {
    this.startTurn({
      ...(this.lastSend ?? { selectedNodeId: null }),
      ...override,
    })
  }

  private startTurn(options: SendOptions, text?: string): void {
    if (this.store.state.running) return
    this.stopped = false
    const epoch = ++this.epoch
    this.runId = null
    this.priorMessageId = this.chat.messages.at(-1)?.id
    this.lastSend = options
    this.patch({ running: true, unread: false })
    let submitted = false
    this.pending = (async () => {
      await this.session.flush()
      if (this.session.state.saveStatus !== "saved")
        throw new Error(
          `Save your latest edits before ${text === undefined ? "retrying this message" : "sending a message"}.`
        )
      if (this.stopped || epoch !== this.epoch) return
      submitted = true
      const request = { body: bodyOf(options) }
      if (text === undefined) await this.chat.regenerate(request)
      else await this.chat.sendMessage({ text }, request)
    })()
      .catch((error: Error) => {
        this.patch({ running: false })
        if (!submitted && text !== undefined && !this.store.state.draft)
          this.patch({ draft: text })
        this.options.onError(error)
      })
      .finally(() => {
        this.pending = null
      })
  }

  async stop(): Promise<void> {
    if (!this.store.state.running && !this.runId) return
    this.stopped = true
    this.epoch += 1
    // Metadata may arrive before onFinish, including during a tool's pause.
    const last = this.chat.messages.at(-1)
    const runId =
      last?.role === "assistant" && last.id !== this.priorMessageId
        ? last.metadata?.runId
        : undefined
    await this.chat.stop()
    await this.pending
    const id = runId ?? this.runId
    if (id) await this.api.cancelChatRun({ runId: id })
    this.runId = null
    this.patch({ running: false })
    this.options.onChanged()
  }

  async settled(): Promise<void> {
    await this.decision
    await this.clearing
  }

  decide = (
    ids: string[],
    status: "accepted" | "rejected",
    runId: string
  ): Promise<void> => {
    if (this.decision) return this.decision
    this.patch({ deciding: true })
    this.session.previewPatches([])
    this.decision = (async () => {
      await this.session.flush()
      if (this.session.state.saveStatus !== "saved")
        throw new Error("Your latest edits have not saved yet.")
      const result = await this.api.decideSuggestions({
        runId,
        decisions: ids.map((suggestionId) => ({ suggestionId, status })),
      })
      this.session.replaceHead(result.head, result.revision, result.updatedAt)
      this.store.setState((s) => ({
        ...s,
        statuses: {
          ...s.statuses,
          ...Object.fromEntries(
            result.results.map((r) => [r.suggestionId, r.status])
          ),
        },
      }))
      this.options.onChanged()
    })()
      .catch((error: Error) => this.options.onError(error))
      .finally(() => {
        this.decision = null
        this.patch({ deciding: false })
      })
    return this.decision
  }

  clear(): Promise<void> {
    if (this.clearing) return this.clearing
    this.patch({ clearing: true })
    this.clearing = (async () => {
      await this.stop()
      await this.decision
      await this.api.clearConversation({
        conversationId: this.session.state.conversationId,
      })
      this.chat.messages = []
      this.session.previewPatches([])
      this.patch({ statuses: {}, unread: false })
      this.options.onChanged()
    })().finally(() => {
      this.clearing = null
      this.patch({ clearing: false })
    })
    return this.clearing
  }

  private async measure(
    toolCallId: string,
    drafts: unknown[],
    epoch: number
  ): Promise<void> {
    const checkFit =
      this.options.measure ??
      (await import("../resume/preview/check-fit")).checkFit
    if (epoch !== this.epoch || this.stopped) return
    const patches: ResumePatch[] = []
    for (const draft of drafts) {
      const result = ResumePatchSchema.safeParse(draft)
      if (result.success) patches.push(result.data)
    }
    const { doc, templateId, templateOptions } = this.session.state
    const result = await checkFit({
      resume: doc,
      templateId,
      options: templateOptions,
      patches,
    })
    if (epoch !== this.epoch || this.stopped) return
    const options = { body: bodyOf(this.lastSend) }
    if (result.ok) {
      await this.chat.addToolOutput({
        tool: "check_fit",
        toolCallId,
        output: { pageCount: result.pageCount, pageSize: result.pageSize },
        options,
      })
    } else {
      await this.chat.addToolOutput({
        tool: "check_fit",
        toolCallId,
        state: "output-error",
        errorText: result.message,
        options,
      })
    }
  }
}

function awaitingFit(message: ChatUIMessage): boolean {
  return message.parts.some(
    (p) =>
      p.type === "tool-check_fit" &&
      (p.state === "input-available" || p.state === "input-streaming")
  )
}

export function checkFitAnswered({
  messages,
}: {
  messages: ChatUIMessage[]
}): boolean {
  const last = messages.at(-1)
  if (last?.role !== "assistant") return false
  const start = last.parts.reduce(
    (at, part, i) => (part.type === "step-start" ? i : at),
    -1
  )
  const calls = last.parts
    .slice(start + 1)
    .filter((p) => p.type === "tool-check_fit")
  return (
    calls.length > 0 &&
    calls.every(
      (p) => p.state === "output-available" || p.state === "output-error"
    )
  )
}

function bodyOf(options: SendOptions | null): ChatTurnInputs {
  return options
    ? {
        hintSkillId: options.hintSkillId,
        selectedNodeId: options.selectedNodeId,
        structural: options.structural,
      }
    : {}
}
