// @vitest-environment node
import type {
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider"
import type { Models } from "@workspace/agent"
import {
  MemoryService,
  ResumeService,
  RunService,
  SuggestionService,
  VersionService,
} from "@workspace/resume-core"
import {
  InMemoryAgentRunRepository,
  InMemoryBackground,
  InMemoryConversationRepository,
  InMemoryDb,
  InMemoryMessageRepository,
  InMemoryResumeRepository,
  InMemorySuggestionRepository,
  InMemorySummaryRepository,
  InMemoryVersionRepository,
  StubSummarizer,
} from "@workspace/resume-core/testing"
import { indexNodes, type ResumePatch } from "@workspace/resume-schema"
import { simulateReadableStream, type UIMessage } from "ai"
import { MockLanguageModelV3 } from "ai/test"
import { describe, expect, it } from "vitest"

import type { Services } from "../container"
import type { Logger } from "../log"
import { type ChatDeps, handleChat } from "./handle-chat"

const usage = {
  inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 30, text: 30, reasoning: 0 },
}

function toolCall(
  toolName: string,
  input: unknown,
  toolCallId = "call-1"
): LanguageModelV3StreamResult {
  const chunks: LanguageModelV3StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: undefined },
      usage,
    },
  ]
  return { stream: simulateReadableStream({ chunks }) }
}

function text(content: string): LanguageModelV3StreamResult {
  const chunks: LanguageModelV3StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: content },
    { type: "text-end", id: "t1" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: undefined },
      usage,
    },
  ]
  return { stream: simulateReadableStream({ chunks }) }
}

const silent: Logger = { info() {}, warn() {}, error() {} }

async function harness(model: MockLanguageModelV3) {
  const db = new InMemoryDb()
  const resumes = new InMemoryResumeRepository(db)
  const versions = new InMemoryVersionRepository(db)
  const runs = new InMemoryAgentRunRepository(db)
  const suggestions = new InMemorySuggestionRepository(db)
  const messages = new InMemoryMessageRepository(db)
  const summaries = new InMemorySummaryRepository(db)
  const summarizer = new StubSummarizer()
  const background = new InMemoryBackground()
  const versionService = new VersionService(resumes, versions)
  const services: Services = {
    resumes: new ResumeService(resumes),
    versions: versionService,
    suggestions: new SuggestionService(resumes, runs, suggestions),
    conversations: new InMemoryConversationRepository(db),
    runs: new RunService(versionService, runs, () => db.now()),
    memory: new MemoryService(messages, summaries, summarizer),
    messages,
  }
  const models: Models = {
    smart: model,
    fast: model,
    ids: { smart: "smart-test", fast: "fast-test" },
    providerOptions: {},
  }
  const deps: ChatDeps = {
    services,
    models,
    background,
    log: silent,
    now: () => db.now(),
  }

  const summary = await services.resumes.create({ title: "Chat test" })
  const record = await services.resumes.get(summary.id)
  const conversation = await services.conversations.getOrCreate(record.id)
  let bullet: { id: string; text: string } | null = null
  for (const ref of indexNodes(record.data).values()) {
    if (ref.kind === "bullet") {
      bullet = ref.node as { id: string; text: string }
      break
    }
  }
  if (!bullet) throw new Error("fixture has no bullets")

  const base = {
    conversationId: conversation.id,
    resumeId: record.id,
    skillId: "bullet_rewrite",
  }
  const post = (body: Record<string, unknown>) =>
    handleChat(
      deps,
      new Request("http://test/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...base, ...body }),
      })
    )

  return { db, services, background, summarizer, deps, record, bullet, post }
}

function user(content: string, id = "u1"): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text: content }] }
}

describe("handleChat", () => {
  it("opens a run, stores both turns, and finishes with usage", async () => {
    // The patch needs the fixture's bullet, which only exists once the
    // harness has created the resume, so the turn is queued after the fact.
    const turns: LanguageModelV3StreamResult[] = []
    const model = new MockLanguageModelV3({
      doStream: async () => {
        const next = turns.shift()
        if (!next) throw new Error("no model turn queued")
        return next
      },
    })
    const h = await harness(model)
    const patch: ResumePatch = {
      op: "replace_text",
      skillId: "bullet_rewrite",
      targetNodeId: h.bullet.id,
      field: "text",
      before: h.bullet.text,
      after: `${h.bullet.text} Shipped on time.`,
      reason: "Leads with the outcome.",
    }
    turns.push(toolCall("propose_patches", { patches: [patch] }))

    const response = await h.post({ messages: [user("Tighten this")] })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    const body = await response.text()
    expect(body).toContain("tool-output-available")

    const run = h.db.runs[0]
    expect(run?.status).toBe("completed")
    expect(run?.inputTokens).toBe(120)
    expect(run?.outputTokens).toBe(30)
    expect(run?.model).toBe("smart-test")
    expect(h.db.versions.map((v) => v.label)).toContain("Before AI run")

    const stored = h.db.messages
    expect(stored.map((m) => m.role)).toEqual(["user", "assistant"])
    expect(stored[0]?.metadata).toEqual({ skillId: "bullet_rewrite" })
    expect(stored[0]?.agentRunId).toBe(run?.id)
    const part = stored[1]?.parts.find((p) => p.type === "tool-propose_patches")
    expect(part?.type === "tool-propose_patches" && part.output).toMatchObject({
      runId: run?.id,
      suggestions: [{ ordinal: 0, patch }],
      rejected: [],
    })
    expect(h.db.suggestions).toHaveLength(1)

    await h.background.flush()
    expect(h.background.tasks).toHaveLength(1)
    expect(h.summarizer.calls).toHaveLength(0)
  })

  it("refuses over the hourly limit with a retry hint", async () => {
    const model = new MockLanguageModelV3({ doStream: [text("hi")] })
    const h = await harness(model)
    for (let i = 0; i < 60; i += 1) {
      const run = await h.services.runs.start({
        conversationId: h.db.conversations[0]?.id ?? "",
        resumeId: h.record.id,
        skillId: "bullet_rewrite",
        model: "test",
        input: {},
      })
      await h.services.runs.finish(run.id, { status: "completed" })
    }
    const response = await h.post({ messages: [user("Again")] })
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toMatch(/^\d+$/)
    expect(await response.json()).toMatchObject({
      error: { code: "RATE_LIMITED" },
    })
    expect(h.db.runs).toHaveLength(60)
  })

  it("rejects a phase 2 skill and a skill missing its input", async () => {
    const h = await harness(new MockLanguageModelV3({ doStream: [] }))
    const phase2 = await h.post({
      messages: [user("Keywords")],
      skillId: "ats_keyword",
      jobDescription: "Staff engineer",
    })
    expect(phase2.status).toBe(400)

    const missing = await h.post({
      messages: [user("Match")],
      skillId: "jd_match",
    })
    expect(missing.status).toBe(400)
    expect(await missing.json()).toMatchObject({
      error: { code: "VALIDATION" },
    })
    expect(h.db.runs).toHaveLength(0)
    expect(h.db.messages).toHaveLength(0)
  })

  it("answers 404 for a conversation that is not the resume's", async () => {
    const h = await harness(new MockLanguageModelV3({ doStream: [] }))
    const response = await h.post({
      messages: [user("Hi")],
      conversationId: "00000000-0000-4000-8000-00000000ffff",
    })
    expect(response.status).toBe(404)
  })

  it("keeps the run open while the browser measures fit", async () => {
    const model = new MockLanguageModelV3({
      doStream: [toolCall("check_fit", { patches: [] })],
    })
    const h = await harness(model)
    const response = await h.post({
      messages: [user("One page")],
      skillId: "condense_to_pages",
      targetPages: 1,
    })
    expect(response.status).toBe(200)
    await response.text()

    expect(h.db.runs[0]?.status).toBe("running")
    expect(h.db.messages.map((m) => m.role)).toEqual(["user"])
    expect(h.background.tasks).toHaveLength(0)
  })

  it("continues the open run with the fit result and no second run", async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        toolCall("check_fit", { patches: [] }),
        text("It already fits on one page."),
      ],
    })
    const h = await harness(model)
    const first = await h.post({
      messages: [user("One page")],
      skillId: "condense_to_pages",
      targetPages: 1,
    })
    await first.text()
    const run = h.db.runs[0]

    const assistant: UIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-check_fit",
          toolCallId: "call-1",
          state: "output-available",
          input: { patches: [] },
          output: { pageCount: 1, pageSize: "A4" },
        },
      ],
    }
    const second = await h.post({
      messages: [user("One page"), assistant],
      skillId: "condense_to_pages",
      targetPages: 1,
    })
    expect(second.status).toBe(200)
    const body = await second.text()
    expect(body).toContain("already fits")

    expect(h.db.runs).toHaveLength(1)
    expect(run?.status).toBe("completed")
    // The model saw the page count the browser reported.
    const replay = JSON.stringify(model.doStreamCalls[1]?.prompt)
    expect(replay).toContain('"pageCount":1')
    // The user turn was stored once, and the assistant turn once, complete.
    expect(h.db.messages.map((m) => m.role)).toEqual(["user", "assistant"])
    const parts = h.db.messages[1]?.parts.map((p) => p.type)
    expect(parts).toEqual(["tool-check_fit", "text"])
    await h.background.flush()
    expect(h.background.tasks).toHaveLength(1)
  })

  it("supersedes a run the browser abandoned mid fit check", async () => {
    const model = new MockLanguageModelV3({
      doStream: [toolCall("check_fit", { patches: [] }), text("Sure.")],
    })
    const h = await harness(model)
    const first = await h.post({
      messages: [user("One page")],
      skillId: "condense_to_pages",
      targetPages: 1,
    })
    await first.text()

    const stalled: UIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-check_fit",
          toolCallId: "call-1",
          state: "input-available",
          input: { patches: [] },
        },
      ],
    }
    const second = await h.post({
      messages: [
        user("One page"),
        stalled,
        user("Never mind, tighten it", "u2"),
      ],
    })
    expect(second.status).toBe(200)
    await second.text()

    expect(h.db.runs.map((r) => r.status)).toEqual(["cancelled", "completed"])
    expect(h.db.runs[0]?.errorClass).toBe("superseded")
  })

  it("answers 409 when a fit result arrives for a run that ended", async () => {
    const h = await harness(new MockLanguageModelV3({ doStream: [] }))
    const assistant: UIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-check_fit",
          toolCallId: "call-1",
          state: "output-available",
          input: { patches: [] },
          output: { pageCount: 1, pageSize: "A4" },
        },
      ],
    }
    const response = await h.post({ messages: [user("One page"), assistant] })
    expect(response.status).toBe(409)
  })
})
