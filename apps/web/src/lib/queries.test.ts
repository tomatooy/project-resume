import { QueryClient } from "@tanstack/react-query"
import { defaultTemplateOptions } from "@workspace/resume-schema"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ResumeSession } from "@/features/resume/store"
import type * as api from "./api"
import {
  invalidateResumes,
  invalidateVersions,
  resumesQuery,
  cacheWorkspaceMessages,
  cacheWorkspaceResume,
  messagesQuery,
  resumeQuery,
  versionsQuery,
  workspaceAssistantApi,
} from "./queries"
import type { DecideResult, ResumeRecord } from "./types"

const server = vi.hoisted(() => ({
  cancelChatRun: vi.fn<typeof api.cancelChatRun>(),
  clearConversation: vi.fn<typeof api.clearConversation>(),
  decideSuggestions: vi.fn<typeof api.decideSuggestions>(),
  getResume: vi.fn<typeof api.getResume>(),
  listMessages: vi.fn<typeof api.listMessages>(),
  listVersions: vi.fn<typeof api.listVersions>(),
}))
vi.mock("./api", () => server)

const record: ResumeRecord = {
  id: "resume-a",
  title: "A",
  subtitle: "",
  templateId: "lisbon",
  updatedAt: "2026-01-01T00:00:00Z",
  revision: 1,
  currentVersionId: null,
  schemaVersion: 1,
  templateOptions: defaultTemplateOptions,
  data: {
    schemaVersion: 1,
    basics: { id: "basics", name: "Jo", email: "jo@example.com", links: [] },
    sections: [],
  },
}
const decision: DecideResult = {
  head: record.data,
  revision: 1,
  updatedAt: record.updatedAt,
  results: [],
}

beforeEach(() => vi.resetAllMocks())

describe("workspace cache", () => {
  it("keeps versions fresh when syncing autosaved documents and chat history", () => {
    const client = new QueryClient()
    const versions = versionsQuery(record.id).queryKey
    client.setQueryData(versions, {
      pages: [{ items: [], nextCursor: null }],
      pageParams: [undefined],
    })
    client.setQueryData(resumeQuery(record.id).queryKey, record)
    const session = new ResumeSession(record, "conversation-a")
    cacheWorkspaceResume(client, session.state)
    const history = { messages: [], suggestions: {} }
    cacheWorkspaceMessages(client, "conversation-a", history)
    expect(client.getQueryState(versions)?.isInvalidated).toBe(false)
    expect(
      client.getQueryData(messagesQuery("conversation-a").queryKey)
    ).toEqual(history)
    session.dispose()
  })

  it("invalidates only the resume whose decision created a version", async () => {
    const client = new QueryClient()
    const versions = versionsQuery(record.id).queryKey
    const other = versionsQuery("resume-b").queryKey
    client.setQueryData(versions, {
      pages: [{ items: [], nextCursor: null }],
      pageParams: [undefined],
    })
    client.setQueryData(other, {
      pages: [{ items: [], nextCursor: null }],
      pageParams: [undefined],
    })
    const mutations = workspaceAssistantApi(client, record.id)
    server.decideSuggestions.mockResolvedValueOnce(decision)
    await mutations.decideSuggestions({ runId: "run-a", decisions: [] })
    expect(client.getQueryState(versions)?.isInvalidated).toBe(false)

    server.decideSuggestions.mockResolvedValueOnce({
      ...decision,
      version: {
        id: "version-a",
        versionNo: 2,
        label: "Accepted suggestions",
        createdBy: "agent",
        createdAt: record.updatedAt,
      },
    })
    await mutations.decideSuggestions({ runId: "run-a", decisions: [] })
    expect(client.getQueryState(versions)?.isInvalidated).toBe(true)
    expect(client.getQueryState(other)?.isInvalidated).toBe(false)
  })

  it("clears cached history only after the server clears it", async () => {
    const client = new QueryClient()
    const messages = messagesQuery("conversation-a").queryKey
    const history = {
      messages: [],
      suggestions: { "suggestion-a": "pending" },
    } satisfies Parameters<typeof cacheWorkspaceMessages>[2]
    client.setQueryData(messages, history)
    const mutations = workspaceAssistantApi(client, record.id)
    server.clearConversation.mockRejectedValueOnce(new Error("offline"))
    await expect(
      mutations.clearConversation({ conversationId: "conversation-a" })
    ).rejects.toThrow("offline")
    expect(client.getQueryData(messages)).toEqual(history)
    server.clearConversation.mockResolvedValueOnce({ ok: true })
    await mutations.clearConversation({ conversationId: "conversation-a" })
    expect(client.getQueryData(messages)).toEqual({
      messages: [],
      suggestions: {},
    })
  })
})

it("drops continuation pages before invalidating lists", async () => {
  const client = new QueryClient()
  client.setQueryData(resumesQuery().queryKey, {
    pages: [
      { items: [], nextCursor: "next", total: 60 },
      { items: [], nextCursor: null },
    ],
    pageParams: [undefined, "next"],
  })
  client.setQueryData(versionsQuery("a").queryKey, {
    pages: [
      { items: [], nextCursor: 30 },
      { items: [], nextCursor: null },
    ],
    pageParams: [undefined, 30],
  })
  await invalidateResumes(client)
  await invalidateVersions(client, "a")
  expect(client.getQueryData(resumesQuery().queryKey)?.pages).toHaveLength(1)
  expect(client.getQueryData(versionsQuery("a").queryKey)?.pages).toHaveLength(
    1
  )
  expect(client.getQueryState(resumesQuery().queryKey)?.isInvalidated).toBe(
    true
  )
  client.clear()
})
