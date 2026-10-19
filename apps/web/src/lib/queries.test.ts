import { QueryClient } from "@tanstack/react-query"
import { emptyProfile } from "@workspace/autofill"
import { defaultTemplateOptions } from "@workspace/resume-schema"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ResumeSession } from "@/features/resume/store"
import type * as api from "./api"
import {
  autofillNotesQuery,
  autofillProfileQuery,
  invalidateResumes,
  invalidateVersions,
  noteVersionQuery,
  noteVersionsQuery,
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
  getAutofillNotes: vi.fn<typeof api.getAutofillNotes>(),
  getAutofillNoteVersion: vi.fn<typeof api.getAutofillNoteVersion>(),
  getAutofillProfile: vi.fn<typeof api.getAutofillProfile>(),
  getResume: vi.fn<typeof api.getResume>(),
  listAutofillNoteVersions: vi.fn<typeof api.listAutofillNoteVersions>(),
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

describe("autofill queries", () => {
  it("keeps every read under one autofill prefix", () => {
    expect([
      autofillProfileQuery().queryKey,
      autofillNotesQuery().queryKey,
      noteVersionsQuery().queryKey,
      noteVersionQuery("version-a").queryKey,
    ]).toEqual([
      ["autofill", "profile"],
      ["autofill", "notes"],
      ["autofill", "note-versions"],
      ["autofill", "note-version", "version-a"],
    ])
  })

  it("reads each through its own server call", async () => {
    const client = new QueryClient()
    const profile = {
      profile: emptyProfile,
      revision: 0,
      updatedAt: null,
      exists: false,
    }
    const notes = { content: "- Lives in SF.", revision: 1, updatedAt: null }
    const version = {
      id: "version-a",
      reason: "edit" as const,
      createdAt: "2026-10-19T00:00:00Z",
      length: 14,
    }
    const snapshot = {
      id: "version-a",
      reason: "edit" as const,
      createdAt: "2026-10-19T00:00:00Z",
      content: "- Lives in SF.",
    }
    server.getAutofillProfile.mockResolvedValue(profile)
    server.getAutofillNotes.mockResolvedValue(notes)
    server.listAutofillNoteVersions.mockResolvedValue([version])
    server.getAutofillNoteVersion.mockResolvedValue(snapshot)
    expect(await client.fetchQuery(autofillProfileQuery())).toEqual(profile)
    expect(await client.fetchQuery(autofillNotesQuery())).toEqual(notes)
    expect(await client.fetchQuery(noteVersionsQuery())).toEqual([version])
    expect(await client.fetchQuery(noteVersionQuery("version-a"))).toEqual(
      snapshot
    )
    expect(server.getAutofillNoteVersion).toHaveBeenCalledWith({
      id: "version-a",
    })
    client.clear()
  })
})
