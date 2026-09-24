import { Store } from "@tanstack/store"
import type { SkillDraft } from "@workspace/resume-core"

import {
  AssistantRuntime,
  type AssistantApi,
} from "@/features/chat/assistant-runtime"
import { createPreviewStore } from "@/features/resume/preview/preview-store"
import { ResumeSession } from "@/features/resume/store"
import type { ChatHistory, ResumeRecord } from "@/lib/types"
import { BLANK_SKILL, SkillEditor } from "./skill-editor"
import {
  tabKey,
  uniqueTabs,
  WorkspaceSnapshotSchema,
  type TabTarget,
  type WorkspaceSnapshot,
} from "./targets"

export type ResumeUi = {
  pane: string
  versionId: string | null
  fullWidth: boolean
}
export function createResumeUi() {
  return new Store<ResumeUi>({
    pane: "contact",
    versionId: null,
    fullWidth: false,
  })
}
export type ResumeRuntime = {
  session: ResumeSession
  preview: ReturnType<typeof createPreviewStore>
  ui: Store<ResumeUi>
  assistant: AssistantRuntime | null
  unsubscribe: () => void
}
export type ClosePrompt = { kind: "skill" | "message"; title: string }
export type CloseAnswer = "save" | "discard" | "cancel"
type WorkspaceState = WorkspaceSnapshot & {
  hydrated: boolean
  closing: boolean
  generation: number
}
export type WorkspaceOptions = {
  navigate: (target: TabTarget | null, replace: boolean) => Promise<void>
  active: () => TabTarget | null
  confirm: (prompt: ClosePrompt) => Promise<CloseAnswer>
  onError: (error: Error, target?: TabTarget) => void
  saveSkill: (draft: SkillDraft, id?: string) => Promise<string>
  resumeChanged: (runtime: ResumeRuntime) => void
  releaseResume: (runtime: ResumeRuntime) => Promise<void>
  assistantApi?: (resumeId: string) => AssistantApi
  session?: (record: ResumeRecord, conversationId: string) => ResumeSession
}

export class Workspace {
  readonly store = new Store<WorkspaceState>({
    version: 1,
    tabs: [],
    lastActiveKey: null,
    hydrated: false,
    closing: false,
    generation: 0,
  })
  readonly resumes = new Map<string, ResumeRuntime>()
  readonly skills = new Map<string, SkillEditor>()
  readonly scroll = new Map<string, number>()
  private storage: Pick<Storage, "getItem" | "setItem"> | null = null
  private lifecycle = 0
  private skillSaves = new Map<SkillEditor, Promise<string>>()

  constructor(
    readonly userId: string,
    private readonly options: WorkspaceOptions
  ) {}

  get storageKey(): string {
    return `resume-studio.workspace.v1:${this.userId}`
  }

  hydrate(
    storage: Pick<Storage, "getItem" | "setItem"> | null,
    restoreHome: boolean
  ): void {
    if (this.store.state.hydrated) return
    this.storage = storage
    let saved: WorkspaceSnapshot = { version: 1, tabs: [], lastActiveKey: null }
    try {
      const raw = storage?.getItem(this.storageKey)
      const parsed = WorkspaceSnapshotSchema.safeParse(
        raw ? JSON.parse(raw) : null
      )
      if (parsed.success) saved = parsed.data
    } catch {
      /* Storage is optional. */
    }
    const active = this.options.active()
    const tabs = uniqueTabs(active ? [...saved.tabs, active] : saved.tabs)
    const restored = tabs.find((tab) => tabKey(tab) === saved.lastActiveKey)
    this.store.setState((s) => ({
      ...s,
      tabs,
      hydrated: true,
      lastActiveKey: active
        ? tabKey(active)
        : restoreHome && restored
          ? tabKey(restored)
          : null,
    }))
    this.persist()
    if (!active && restoreHome && restored)
      void this.options.navigate(restored, true).catch(this.options.onError)
  }

  ensureRouteTab(target: TabTarget | null): void {
    if (!this.store.state.hydrated) return
    this.store.setState((s) => ({
      ...s,
      tabs: target ? uniqueTabs([...s.tabs, target]) : s.tabs,
      lastActiveKey: target ? tabKey(target) : null,
    }))
    if (target?.kind === "resume")
      this.resumes.get(target.resumeId)?.assistant?.patch({ unread: false })
    this.persist()
  }

  openTab = async (target: TabTarget): Promise<void> => {
    if (this.store.state.closing) return
    await this.options.navigate(target, false)
    this.ensureRouteTab(this.options.active())
  }

  activateTab = async (key: string): Promise<void> => {
    const tab = this.store.state.tabs.find((target) => tabKey(target) === key)
    if (tab) await this.openTab(tab)
  }

  moveTab(key: string, index: number): void {
    if (this.store.state.closing) return
    this.store.setState((s) => {
      const tabs = s.tabs.filter((tab) => tabKey(tab) !== key)
      const tab = s.tabs.find((tab) => tabKey(tab) === key)
      if (!tab) return s
      tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, tab)
      return { ...s, tabs }
    })
    this.persist()
  }

  async replaceTabTarget(key: string, target: TabTarget): Promise<void> {
    const active = this.options.active()
    this.store.setState((s) => ({
      ...s,
      tabs: uniqueTabs(
        s.tabs.map((tab) => (tabKey(tab) === key ? target : tab))
      ),
    }))
    if (active && tabKey(active) === key)
      await this.options.navigate(target, true)
    this.ensureRouteTab(this.options.active())
  }

  ensureResume(record: ResumeRecord, conversationId: string): ResumeRuntime {
    const existing = this.resumes.get(record.id)
    if (existing) return existing
    const session =
      this.options.session?.(record, conversationId) ??
      new ResumeSession(record, conversationId)
    const runtime: ResumeRuntime = {
      session,
      preview: createPreviewStore(),
      ui: createResumeUi(),
      assistant: null,
      unsubscribe: () => undefined,
    }
    let cached = session.state
    const subscription = session.store.subscribe(() => {
      const next = session.state
      if (
        next.saveStatus !== "saved" ||
        (next.doc === cached.doc &&
          next.revision === cached.revision &&
          next.templateId === cached.templateId &&
          next.templateOptions === cached.templateOptions)
      )
        return
      cached = next
      this.options.resumeChanged(runtime)
    })
    runtime.unsubscribe = () => subscription.unsubscribe()
    this.resumes.set(record.id, runtime)
    queueMicrotask(() => this.bump())
    return runtime
  }

  ensureAssistant(
    runtime: ResumeRuntime,
    history: ChatHistory
  ): AssistantRuntime {
    if (runtime.assistant) return runtime.assistant
    runtime.assistant = new AssistantRuntime(runtime.session, history, {
      api: this.options.assistantApi?.(runtime.session.state.resumeId),
      onError: this.options.onError,
      onChanged: () => this.options.resumeChanged(runtime),
      isActive: () => {
        const active = this.options.active()
        return (
          active?.kind === "resume" &&
          active.resumeId === runtime.session.state.resumeId
        )
      },
    })
    queueMicrotask(() => this.bump())
    return runtime.assistant
  }

  ensureSkill(id: string, initial: SkillDraft = BLANK_SKILL): SkillEditor {
    const existing = this.skills.get(id)
    if (existing) return existing
    const editor = new SkillEditor(initial, id === "new" ? undefined : id)
    this.skills.set(id, editor)
    queueMicrotask(() => this.bump())
    return editor
  }

  saveSkill(editor: SkillEditor): Promise<string> {
    const pending = this.skillSaves.get(editor)
    if (pending) return pending
    const saving = this.commitSkill(editor).finally(() => {
      this.skillSaves.delete(editor)
    })
    this.skillSaves.set(editor, saving)
    return saving
  }

  private async commitSkill(editor: SkillEditor): Promise<string> {
    const oldId = editor.skillId ?? "new"
    const id = await editor.save(this.options.saveSkill)
    if (oldId !== id) {
      this.skills.delete(oldId)
      this.skills.set(id, editor)
      await this.replaceTabTarget(tabKey({ kind: "skill", skillId: oldId }), {
        kind: "skill",
        skillId: id,
      })
    }
    return id
  }

  async requestCloseTabs(keys: string[]): Promise<boolean> {
    if (this.store.state.closing) return false
    this.store.setState((s) => ({ ...s, closing: true }))
    let closing = new Set(keys)
    let failedTarget: TabTarget | undefined
    try {
      const targets = this.store.state.tabs.filter((tab) =>
        closing.has(tabKey(tab))
      )
      const releasedResumes = [...this.resumes.entries()].filter(
        ([id]) =>
          targets.some((tab) => tab.kind === "resume" && tab.resumeId === id) &&
          !this.store.state.tabs.some(
            (tab) =>
              tab.kind === "resume" &&
              tab.resumeId === id &&
              !closing.has(tabKey(tab))
          )
      )
      for (const [id, runtime] of releasedResumes) {
        failedTarget = { kind: "resume", resumeId: id, view: "editor" }
        await runtime.assistant?.settled()
        await runtime.session.settled()
        if (
          !runtime.session.state.validity.savable ||
          runtime.session.state.saveStatus === "conflict"
        )
          throw new Error(
            "Open the resume's Editor to fix errors or resolve its save conflict before closing."
          )
        await runtime.session.flush()
        if (runtime.session.state.saveStatus !== "saved")
          throw new Error(
            "Your resume could not be saved. The tabs remain open; return to Editor to retry."
          )
        if (runtime.assistant?.store.state.draft.trim()) {
          const answer = await this.options.confirm({
            kind: "message",
            title: "Discard the unsent message?",
          })
          if (answer !== "discard") return false
        }
        // Retained until every target has passed its close guard.
        if (!this.resumes.has(id)) return false
      }
      for (const target of targets) {
        if (target.kind !== "skill") continue
        failedTarget = target
        const editor = this.skills.get(target.skillId)
        if (!editor) continue
        await this.skillSaves.get(editor)
        await editor.settled()
        if (editor.store.state.dirty) {
          const answer = await this.options.confirm({
            kind: "skill",
            title: `Save changes to ${editor.store.state.fields.name || "New skill"}?`,
          })
          if (answer === "cancel") return false
          if (answer === "save") await this.saveSkill(editor)
        }
        if (editor.skillId && editor.skillId !== target.skillId) {
          closing = new Set(
            [...closing].map((key) =>
              key === tabKey(target)
                ? tabKey({ kind: "skill", skillId: editor.skillId ?? "new" })
                : key
            )
          )
        }
      }
      for (const [id, runtime] of releasedResumes) {
        if (
          this.store.state.tabs.some(
            (tab) =>
              tab.kind === "resume" &&
              tab.resumeId === id &&
              !closing.has(tabKey(tab))
          )
        )
          continue
        failedTarget = { kind: "resume", resumeId: id, view: "editor" }
        await runtime.assistant?.stop()
      }
      await this.removeTabs(closing)
      for (const [id, runtime] of releasedResumes) {
        // Browser history can reopen a resource while close guards await work.
        if (
          this.store.state.tabs.some(
            (tab) => tab.kind === "resume" && tab.resumeId === id
          )
        )
          continue
        await this.options.releaseResume(runtime)
        if (
          this.store.state.tabs.some(
            (tab) => tab.kind === "resume" && tab.resumeId === id
          )
        )
          continue
        runtime.unsubscribe()
        runtime.session.dispose()
        this.resumes.delete(id)
      }
      for (const key of closing) {
        if (key.startsWith("skill:")) this.skills.delete(key.slice(6))
      }
      this.bump()
      return true
    } catch (error) {
      this.options.onError(
        error instanceof Error
          ? error
          : new Error("Could not close these tabs."),
        failedTarget
      )
      return false
    } finally {
      this.store.setState((s) => ({ ...s, closing: false }))
    }
  }

  async forgetResource(kind: "resume" | "skill", id: string): Promise<void> {
    const keys = this.store.state.tabs
      .filter((tab) =>
        kind === "resume"
          ? tab.kind === "resume" && tab.resumeId === id
          : tab.kind === "skill" && tab.skillId === id
      )
      .map(tabKey)
    if (kind === "resume") {
      const runtime = this.resumes.get(id)
      if (runtime) {
        runtime.unsubscribe()
        runtime.session.dispose()
        void runtime.assistant?.stop().catch(() => undefined)
        this.resumes.delete(id)
      }
    } else this.skills.delete(id)
    await this.removeTabs(new Set(keys))
    this.bump()
  }

  private async removeTabs(closing: Set<string>): Promise<void> {
    const tabs = this.store.state.tabs
    const active = this.options.active()
    const at = active
      ? tabs.findIndex((tab) => tabKey(tab) === tabKey(active))
      : -1
    if (active && closing.has(tabKey(active))) {
      const next =
        tabs.slice(at + 1).find((tab) => !closing.has(tabKey(tab))) ??
        tabs
          .slice(0, at)
          .reverse()
          .find((tab) => !closing.has(tabKey(tab))) ??
        null
      await this.options.navigate(next, true)
    }
    this.store.setState((s) => ({
      ...s,
      tabs: s.tabs.filter((tab) => !closing.has(tabKey(tab))),
    }))
    for (const key of closing) this.scroll.delete(key)
    this.ensureRouteTab(this.options.active())
  }

  hasUnsaved(): boolean {
    return (
      [...this.resumes.values()].some(
        (r) =>
          r.session.state.saveStatus !== "saved" ||
          r.session.hasPendingWrites ||
          r.assistant?.store.state.deciding ||
          r.assistant?.store.state.clearing ||
          Boolean(r.assistant?.store.state.draft.trim()) ||
          r.assistant?.store.state.running
      ) ||
      [...this.skills.values()].some(
        (s) => s.store.state.dirty || s.store.state.busy
      )
    )
  }

  activate(): void {
    this.lifecycle += 1
    for (const r of this.resumes.values()) r.session.activate()
  }
  disposeLater(): void {
    const generation = ++this.lifecycle
    queueMicrotask(() => {
      if (generation !== this.lifecycle) return
      for (const runtime of this.resumes.values()) {
        void runtime.assistant?.stop().catch(() => undefined)
        void runtime.session.flush()
        runtime.session.dispose()
        runtime.unsubscribe()
      }
      this.resumes.clear()
      this.skills.clear()
      this.scroll.clear()
    })
  }

  private bump(): void {
    this.store.setState((s) => ({ ...s, generation: s.generation + 1 }))
  }
  private persist(): void {
    const { hydrated, tabs, lastActiveKey } = this.store.state
    if (!hydrated) return
    try {
      this.storage?.setItem(
        this.storageKey,
        JSON.stringify({ version: 1, tabs, lastActiveKey })
      )
    } catch {
      /* In-memory tabs still work. */
    }
  }
}
