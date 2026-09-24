import { describe, expect, it, vi } from "vitest"
import { waitFor } from "@testing-library/react"
import type { ChatTransport, UIMessageChunk } from "ai"
import { defaultTemplateOptions } from "@workspace/resume-schema"
import type { ChatUIMessage, ResumeRecord } from "@/lib/types"
import { ResumeSession } from "../resume/store"
import { AssistantRuntime, type AssistantApi } from "./assistant-runtime"

vi.mock("@/lib/api", () => ({}))

function fixture(id: string): ResumeRecord {
  return {
    id,
    title: id,
    subtitle: "",
    templateId: "lisbon",
    updatedAt: "2026-01-01T00:00:00Z",
    revision: 1,
    currentVersionId: null,
    schemaVersion: 1,
    templateOptions: defaultTemplateOptions,
    data: {
      schemaVersion: 1,
      basics: { id: "basics", name: id, email: "jo@example.com", links: [] },
      sections: [],
    },
  }
}
function harness(
  id: string,
  measure?: ConstructorParameters<typeof AssistantRuntime>[2]["measure"]
) {
  const streams: ReadableStreamDefaultController<UIMessageChunk>[] = []
  const sendMessages: ChatTransport<ChatUIMessage>["sendMessages"] = vi.fn(
    async ({ abortSignal }) =>
      new ReadableStream<UIMessageChunk>({
        start(controller) {
          streams.push(controller)
          abortSignal?.addEventListener("abort", () => {
            try {
              controller.error(new DOMException("Aborted", "AbortError"))
            } catch {
              /* Already closed. */
            }
          })
        },
      })
  )
  const cancel = vi.fn(async () => ({ ok: true }))
  const decide = vi.fn<AssistantApi["decideSuggestions"]>()
  const clear = vi.fn<AssistantApi["clearConversation"]>()
  const updateResume = vi.fn(async () => ({
    revision: 2,
    updatedAt: "2026-01-02T00:00:00Z",
  }))
  const session = new ResumeSession(fixture(id), `conversation-${id}`, {
    api: {
      updateResume,
      setTemplate: async () => ({ ok: true }),
    },
  })
  const onError = vi.fn()
  const runtime = new AssistantRuntime(
    session,
    { messages: [], suggestions: {} },
    {
      onError,
      onChanged: () => undefined,
      isActive: () => false,
      api: {
        cancelChatRun: cancel,
        decideSuggestions: decide,
        clearConversation: clear,
      },
      measure,
      transport: { sendMessages, reconnectToStream: async () => null },
    }
  )
  async function stream(index = 0) {
    await waitFor(() => expect(streams.length).toBeGreaterThan(index))
    const stream = streams[index]
    if (!stream) throw new Error("missing stream")
    return stream
  }
  return {
    runtime,
    cancel,
    decide,
    clear,
    updateResume,
    onError,
    sendMessages,
    stream,
  }
}

describe("assistant runtime", () => {
  it("receives messages without a mounted panel and keeps resumes isolated", async () => {
    const a = harness("A")
    const b = harness("B")
    a.runtime.send("Help", { selectedNodeId: null })
    const stream = await a.stream()
    stream.enqueue({
      type: "start",
      messageId: "answer-a",
      messageMetadata: { runId: "run-a" },
    })
    stream.enqueue({ type: "text-start", id: "text" })
    stream.enqueue({ type: "text-delta", id: "text", delta: "Only for A" })
    stream.enqueue({ type: "text-end", id: "text" })
    stream.enqueue({ type: "finish" })
    stream.close()
    await waitFor(() => expect(a.runtime.store.state.running).toBe(false))
    expect(a.runtime.chat.messages.at(-1)?.parts).toContainEqual({
      type: "text",
      text: "Only for A",
      state: "done",
    })
    expect(a.runtime.store.state.unread).toBe(true)
    expect(b.runtime.chat.messages).toEqual([])
    expect(a.onError).not.toHaveBeenCalled()
  })
  it("cancels a paused fit run and ignores a late browser measurement", async () => {
    let resolveMeasure: (value: {
      ok: true
      pageCount: number
      pageSize: "A4"
    }) => void = () => undefined
    const measure = vi.fn<
      NonNullable<ConstructorParameters<typeof AssistantRuntime>[2]["measure"]>
    >(
      () =>
        new Promise<{ ok: true; pageCount: number; pageSize: "A4" }>(
          (resolve) => {
            resolveMeasure = resolve
          }
        )
    )
    const h = harness("A", measure)
    h.runtime.send("Fit one page", { selectedNodeId: null })
    const stream = await h.stream()
    stream.enqueue({
      type: "start",
      messageId: "answer-a",
      messageMetadata: { runId: "run-a" },
    })
    stream.enqueue({ type: "start-step" })
    stream.enqueue({
      type: "tool-input-available",
      toolCallId: "fit-a",
      toolName: "check_fit",
      input: { patches: [] },
    })
    stream.enqueue({ type: "finish-step" })
    stream.enqueue({ type: "finish" })
    stream.close()
    await waitFor(() => expect(measure).toHaveBeenCalledTimes(1))
    expect(measure.mock.calls[0]?.[0].resume.basics.name).toBe("A")
    await h.runtime.stop()
    expect(h.cancel).toHaveBeenCalledWith({ runId: "run-a" })
    resolveMeasure({ ok: true, pageCount: 1, pageSize: "A4" })
    await Promise.resolve()
    await Promise.resolve()
    expect(h.sendMessages).toHaveBeenCalledTimes(1)
    expect(h.runtime.store.state.running).toBe(false)
  })
  it("keeps the runtime available when cancellation fails, so stopping can be retried", async () => {
    const h = harness("A")
    h.runtime.send("Help", { selectedNodeId: null })
    const stream = await h.stream()
    stream.enqueue({
      type: "start",
      messageId: "answer-a",
      messageMetadata: { runId: "run-a" },
    })
    await waitFor(() =>
      expect(h.runtime.chat.messages.at(-1)?.metadata?.runId).toBe("run-a")
    )
    h.cancel.mockRejectedValueOnce(new Error("offline"))
    await expect(h.runtime.stop()).rejects.toThrow("offline")
    await h.runtime.stop()
    expect(h.cancel).toHaveBeenCalledTimes(2)
  })

  it("retains unsent input and does not start a request when the document is invalid", async () => {
    const h = harness("A")
    h.runtime.session.apply([
      {
        op: "replace_text",
        targetNodeId: "basics",
        field: "name",
        before: "A",
        after: "",
        reason: "Clear name",
      },
    ])
    h.runtime.send("Keep this input", { selectedNodeId: null })
    await waitFor(() => expect(h.runtime.store.state.running).toBe(false))
    expect(h.sendMessages).not.toHaveBeenCalled()
    expect(h.runtime.store.state.draft).toBe("Keep this input")
    expect(h.onError).toHaveBeenCalledTimes(1)
    h.runtime.session.dispose()
  })

  it.each(["send", "retry"])(
    "stops %s while edits are saving without submitting a request",
    async (operation) => {
      const h = harness("A")
      h.runtime.chat.messages = [
        { id: "user-a", role: "user", parts: [{ type: "text", text: "Help" }] },
      ]
      h.runtime.session.apply([
        {
          op: "replace_text",
          targetNodeId: "basics",
          field: "name",
          before: "A",
          after: "Updated",
          reason: "Edit name",
        },
      ])
      let finishSave: () => void = () => undefined
      const saving = new Promise<void>((resolve) => {
        finishSave = resolve
      })
      h.updateResume.mockImplementationOnce(async () => {
        await saving
        return { revision: 2, updatedAt: "2026-01-02T00:00:00Z" }
      })
      if (operation === "send")
        h.runtime.send("Help again", { selectedNodeId: null })
      else h.runtime.retry()
      await waitFor(() => expect(h.updateResume).toHaveBeenCalledOnce())
      const stopping = h.runtime.stop()
      finishSave()
      await stopping
      expect(h.sendMessages).not.toHaveBeenCalled()
      expect(h.runtime.store.state.running).toBe(false)
      expect(h.onError).not.toHaveBeenCalled()
      h.runtime.session.dispose()
    }
  )

  it("retries the previous message with its selection and overridden options", async () => {
    const h = harness("A")
    h.runtime.send("Help", {
      selectedNodeId: "basics",
      hintSkillId: "tighten",
    })
    const first = await h.stream()
    first.enqueue({ type: "start", messageId: "answer-a" })
    first.enqueue({ type: "finish" })
    first.close()
    await waitFor(() => expect(h.runtime.store.state.running).toBe(false))
    h.runtime.retry({ structural: true })
    const retried = await h.stream(1)
    expect(h.sendMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({
        trigger: "regenerate-message",
        body: {
          selectedNodeId: "basics",
          hintSkillId: "tighten",
          structural: true,
        },
      })
    )
    retried.enqueue({ type: "start", messageId: "answer-retried" })
    retried.enqueue({ type: "finish" })
    retried.close()
    await waitFor(() => expect(h.runtime.store.state.running).toBe(false))
    expect(h.onError).not.toHaveBeenCalled()
  })

  it("uses the injected mutations when deciding and clearing", async () => {
    const h = harness("A")
    h.decide.mockResolvedValue({
      head: fixture("A").data,
      revision: 2,
      updatedAt: "2026-01-02T00:00:00Z",
      results: [{ suggestionId: "suggestion-a", status: "accepted" }],
    })
    h.clear.mockResolvedValue({ ok: true })
    await h.runtime.decide(["suggestion-a"], "accepted", "run-a")
    expect(h.decide).toHaveBeenCalledWith({
      runId: "run-a",
      decisions: [{ suggestionId: "suggestion-a", status: "accepted" }],
    })
    expect(h.runtime.store.state.statuses["suggestion-a"]).toBe("accepted")
    await h.runtime.clear()
    expect(h.clear).toHaveBeenCalledWith({ conversationId: "conversation-A" })
    expect(h.runtime.store.state.statuses).toEqual({})
  })
})
