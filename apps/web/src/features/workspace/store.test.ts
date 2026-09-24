import { defaultTemplateOptions } from "@workspace/resume-schema"
import { describe, expect, it, vi } from "vitest"
import { ResumeSession } from "../resume/store"
import { fakeClock } from "../resume/fake-clock"
import { ApiError, type ResumeRecord } from "@/lib/types"
import { Workspace, type CloseAnswer } from "./store"
import { routeTarget, tabKey, type TabTarget } from "./targets"

vi.mock("@/lib/api", () => ({}))

function record(id = "a"): ResumeRecord {
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
      basics: { id: "basics", name: "Jo", email: "jo@example.com", links: [] },
      sections: [],
    },
  }
}
const a: TabTarget = { kind: "resume", resumeId: "a", view: "editor" }
const b: TabTarget = { kind: "resume", resumeId: "b", view: "editor" }
const exported: TabTarget = { kind: "resume", resumeId: "a", view: "export" }
const skill: TabTarget = { kind: "skill", skillId: "new" }
const validSkill = {
  category: "editor" as const,
  name: "Terse",
  description: "Short prose",
  body: "Prefer short sentences.",
}

function harness(initial: TabTarget | null = a) {
  let active = initial
  const navigate = vi.fn(async (target: TabTarget | null) => {
    active = target
  })
  const confirm = vi.fn<() => Promise<CloseAnswer>>(async () => "cancel")
  const onError = vi.fn()
  const write = vi.fn(async () => ({
    revision: 2,
    updatedAt: "2026-01-02T00:00:00Z",
  }))
  const release = vi.fn(async () => undefined)
  const saveSkill = vi.fn(async () => "usr_saved")
  const workspace = new Workspace("user-1", {
    navigate,
    active: () => active,
    confirm,
    onError,
    saveSkill,
    resumeChanged: () => undefined,
    releaseResume: release,
    session: (r, c) =>
      new ResumeSession(r, c, {
        clock: fakeClock().clock,
        api: { updateResume: write, setTemplate: async () => ({ ok: true }) },
      }),
  })
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
  return {
    workspace,
    navigate,
    confirm,
    onError,
    write,
    release,
    saveSkill,
    data,
    storage,
    get active() {
      return active
    },
    setActive(target: TabTarget | null) {
      active = target
      workspace.ensureRouteTab(target)
    },
  }
}

function edit(session: ResumeSession, name: string) {
  session.apply([
    {
      op: "replace_text",
      reason: "Edit name",
      targetNodeId: "basics",
      field: "name",
      before: session.state.doc.basics.name,
      after: name,
    },
  ])
}

describe("workspace", () => {
  it("merges a deep link with stored tabs once, deduplicates, and persists metadata only", () => {
    const h = harness()
    h.data.set(
      h.workspace.storageKey,
      JSON.stringify({ version: 1, tabs: [b, b], lastActiveKey: tabKey(b) })
    )
    h.workspace.hydrate(h.storage, false)
    expect(h.workspace.store.state.tabs).toEqual([b, a])
    expect(h.workspace.store.state.lastActiveKey).toBe(tabKey(a))
    expect(h.navigate).not.toHaveBeenCalled()
    expect(JSON.parse(h.data.get(h.workspace.storageKey) ?? "")).toEqual({
      version: 1,
      tabs: [b, a],
      lastActiveKey: tabKey(a),
    })
    expect(h.workspace.resumes.size).toBe(0)
  })
  it("restores the last active resource only on the initial home visit", () => {
    const h = harness(null)
    h.data.set(
      h.workspace.storageKey,
      JSON.stringify({ version: 1, tabs: [a], lastActiveKey: tabKey(a) })
    )
    h.workspace.hydrate(h.storage, true)
    expect(h.navigate).toHaveBeenCalledWith(a, true)
    h.setActive(null)
    h.workspace.hydrate(h.storage, true)
    expect(h.navigate).toHaveBeenCalledTimes(1)
  })
  it("ignores corrupt storage and another account's snapshot", () => {
    const h = harness()
    h.data.set(
      "resume-studio.workspace.v1:other",
      JSON.stringify({ version: 1, tabs: [b], lastActiveKey: tabKey(b) })
    )
    h.data.set(h.workspace.storageKey, "invalid json")
    h.workspace.hydrate(h.storage, false)
    expect(h.workspace.store.state.tabs).toEqual([a])
  })
  it("works without storage and preserves a single session and undo stack across views", async () => {
    const h = harness()
    h.workspace.hydrate(null, false)
    const first = h.workspace.ensureResume(record(), "conversation-a")
    edit(first.session, "Jane")
    await h.workspace.openTab(exported)
    await h.workspace.openTab(b)
    await h.workspace.openTab(a)
    expect(h.workspace.store.state.tabs).toEqual([a, exported, b])
    expect(h.workspace.ensureResume(record(), "conversation-a")).toBe(first)
    first.session.undo()
    expect(first.session.state.doc.basics.name).toBe("Jo")
  })
  it("closing a view leaves a shared session running without a save", async () => {
    const h = harness()
    h.workspace.hydrate(null, false)
    const runtime = h.workspace.ensureResume(record(), "conversation-a")
    edit(runtime.session, "Jane")
    await h.workspace.openTab(exported)
    expect(await h.workspace.requestCloseTabs([tabKey(a)])).toBe(true)
    expect(h.write).not.toHaveBeenCalled()
    expect(h.workspace.resumes.get("a")).toBe(runtime)
  })
  it("closes active tabs to the right, then left, then dashboard, and history can reopen them", async () => {
    const h = harness()
    h.workspace.hydrate(null, false)
    await h.workspace.openTab(b)
    await h.workspace.openTab(exported)
    h.setActive(b)
    await h.workspace.requestCloseTabs([tabKey(b)])
    expect(h.active).toEqual(exported)
    await h.workspace.requestCloseTabs([tabKey(exported)])
    expect(h.active).toEqual(a)
    await h.workspace.requestCloseTabs([tabKey(a)])
    expect(h.active).toBeNull()
    expect(h.workspace.store.state.tabs).toEqual([])
    h.setActive(b)
    expect(h.workspace.store.state.tabs).toEqual([b])
  })
  it("keeps every target open when autosave fails", async () => {
    const h = harness()
    h.workspace.hydrate(null, false)
    const runtime = h.workspace.ensureResume(record(), "conversation-a")
    edit(runtime.session, "Jane")
    h.write.mockRejectedValue(new Error("offline"))
    await h.workspace.openTab(b)
    expect(await h.workspace.requestCloseTabs([tabKey(a), tabKey(b)])).toBe(
      false
    )
    expect(h.workspace.store.state.tabs).toEqual([a, b])
    expect(h.release).not.toHaveBeenCalled()
  })
  it("does not retry a conflicted document or discard invalid edits", async () => {
    const h = harness()
    h.workspace.hydrate(null, false)
    const runtime = h.workspace.ensureResume(record(), "conversation-a")
    edit(runtime.session, "Jane")
    h.write.mockRejectedValue(new ApiError("CONFLICT", "Conflict", 409))
    await runtime.session.flush()
    await h.workspace.requestCloseTabs([tabKey(a)])
    expect(h.write).toHaveBeenCalledTimes(1)
    edit(runtime.session, "")
    await h.workspace.requestCloseTabs([tabKey(a)])
    expect(h.workspace.resumes.get("a")).toBe(runtime)
  })
  it("waits for resource writes before releasing the final tab", async () => {
    const h = harness()
    h.workspace.hydrate(null, false)
    const runtime = h.workspace.ensureResume(record(), "conversation-a")
    let finish: () => void = () => undefined
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    void runtime.session.track(pending)
    const closing = h.workspace.requestCloseTabs([tabKey(a)])
    await Promise.resolve()
    expect(h.release).not.toHaveBeenCalled()
    finish()
    expect(await closing).toBe(true)
    expect(h.release).toHaveBeenCalledTimes(1)
    expect(h.workspace.resumes.size).toBe(0)
  })
  it("preserves skill drafts, replaces saved identities in place, and does not steal focus", async () => {
    const h = harness()
    h.workspace.hydrate(null, false)
    await h.workspace.openTab(skill)
    const editor = h.workspace.ensureSkill("new")
    editor.replace(validSkill)
    await h.workspace.openTab(b)
    expect(h.workspace.ensureSkill("new")).toBe(editor)
    await h.workspace.saveSkill(editor)
    expect(h.active).toEqual(b)
    expect(h.workspace.store.state.tabs).toEqual([
      a,
      { kind: "skill", skillId: "usr_saved" },
      b,
    ])
  })
  it("does not partially remove tabs when a skill close is cancelled", async () => {
    const h = harness()
    h.workspace.hydrate(null, false)
    await h.workspace.openTab(skill)
    h.workspace.ensureSkill("new").replace(validSkill)
    expect(await h.workspace.requestCloseTabs([tabKey(a), tabKey(skill)])).toBe(
      false
    )
    expect(h.workspace.store.state.tabs).toEqual([a, skill])
    h.confirm.mockResolvedValue("save")
    expect(await h.workspace.requestCloseTabs([tabKey(skill)])).toBe(true)
    expect(h.workspace.skills.size).toBe(0)
  })
  it("reorders without navigation and deletes all views of a deleted resource", async () => {
    const h = harness()
    h.workspace.hydrate(null, false)
    await h.workspace.openTab(exported)
    await h.workspace.openTab(b)
    h.workspace.moveTab(tabKey(b), 0)
    expect(h.workspace.store.state.tabs).toEqual([b, a, exported])
    h.setActive(a)
    await h.workspace.forgetResource("resume", "a")
    expect(h.workspace.store.state.tabs).toEqual([b])
    expect(h.active).toEqual(b)
  })

  it("waits for an in-flight new skill save and closes the replacement identity", async () => {
    const h = harness(skill)
    h.workspace.hydrate(null, false)
    const editor = h.workspace.ensureSkill("new")
    editor.replace(validSkill)
    let finish: (id: string) => void = () => undefined
    h.saveSkill.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        })
    )
    const saving = h.workspace.saveSkill(editor)
    const closing = h.workspace.requestCloseTabs([tabKey(skill)])
    await Promise.resolve()
    expect(h.workspace.store.state.tabs).toEqual([skill])
    finish("usr_saved")
    await saving
    expect(await closing).toBe(true)
    expect(h.workspace.store.state.tabs).toEqual([])
    expect(h.workspace.skills.size).toBe(0)
    expect(h.active).toBeNull()
  })

  it("keeps tabs and sessions when stopping fails and can retry the same close", async () => {
    const h = harness()
    h.workspace.hydrate(null, false)
    const runtime = h.workspace.ensureResume(record(), "conversation-a")
    const assistant = h.workspace.ensureAssistant(runtime, {
      messages: [],
      suggestions: {},
    })
    const stop = vi
      .spyOn(assistant, "stop")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined)
    expect(await h.workspace.requestCloseTabs([tabKey(a)])).toBe(false)
    expect(h.workspace.store.state.tabs).toEqual([a])
    expect(h.workspace.resumes.get("a")).toBe(runtime)
    expect(await h.workspace.requestCloseTabs([tabKey(a)])).toBe(true)
    expect(stop).toHaveBeenCalledTimes(2)
  })

  it("does not create or dispose duplicate sessions during a strict remount", async () => {
    const h = harness()
    const runtime = h.workspace.ensureResume(record(), "conversation-a")
    const dispose = vi.spyOn(runtime.session, "dispose")
    h.workspace.activate()
    h.workspace.disposeLater()
    h.workspace.activate()
    await Promise.resolve()
    expect(dispose).not.toHaveBeenCalled()
    expect(h.workspace.ensureResume(record(), "conversation-a")).toBe(runtime)
    edit(runtime.session, "Jane")
    await runtime.session.flush()
    expect(h.write).toHaveBeenCalledTimes(1)
    h.workspace.disposeLater()
    await Promise.resolve()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(h.workspace.resumes.size).toBe(0)
  })

  it("rejects malformed or unrelated routes without breaking the shell", () => {
    expect(routeTarget("/r/%bad/edit")).toBeNull()
    expect(routeTarget("/skills/one/extra")).toBeNull()
    expect(routeTarget("/dashboard")).toBeNull()
    expect(routeTarget("/r/a/versions")).toEqual({
      kind: "resume",
      resumeId: "a",
      view: "versions",
    })
  })

  it("retains the session if history opens another view while its final tab is closing", async () => {
    const h = harness()
    h.workspace.hydrate(null, false)
    const runtime = h.workspace.ensureResume(record(), "conversation-a")
    let finish: () => void = () => undefined
    void runtime.session.track(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    const closing = h.workspace.requestCloseTabs([tabKey(a)])
    h.setActive(exported)
    finish()
    expect(await closing).toBe(true)
    expect(h.workspace.store.state.tabs).toEqual([exported])
    expect(h.workspace.resumes.get("a")).toBe(runtime)
    expect(h.release).not.toHaveBeenCalled()
  })
})
