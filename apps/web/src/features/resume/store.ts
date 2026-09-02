import { Store } from "@tanstack/store"
import {
  applyPatches,
  ResumeSchema,
  type Resume,
  type ResumePatch,
} from "@workspace/resume-schema"
import type { TemplateId, TemplateOptions } from "@workspace/resume-render"

import { setTemplate, updateResume } from "@/lib/api"
import { ApiError, type ResumeRecord } from "@/lib/types"

export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict"

export type ResumeState = {
  resumeId: string
  /** The live document every surface reads. */
  doc: Resume
  /** The last document the server acknowledged, for conflict recovery. */
  savedDoc: Resume
  /**
   * The optimistic-concurrency token. Moved by document writes only, so a
   * rename or a template switch cannot make the next autosave a false conflict.
   */
  revision: number
  /** Display only. `revision` is what guards a save. */
  updatedAt: string
  /** The conversation this resume's assistant runs belong to. */
  conversationId: string
  templateId: TemplateId
  templateOptions: TemplateOptions
  saveStatus: SaveStatus
  /** Set by clicking an item or focusing a bullet; scopes AI requests. */
  selectedNodeId: string | null
  /** Applied on top of `doc` in the preview only, while hovering a suggestion. */
  previewPatches: ResumePatch[]
  /** True while a field is failing validation, which pauses autosave. */
  hasFieldErrors: boolean
}

/**
 * Most edits are patches, but adding a section replaces the whole document,
 * because a top-level section has no parent node for `insert_after` to target.
 */
type UndoEntry =
  | { kind: "patches"; patches: ResumePatch[] }
  | { kind: "doc"; doc: Resume }

/**
 * Folds a coalesced run of single-field text inverses back into one patch, so
 * typing a long sentence leaves one entry rather than one per character. The
 * oldest patch already restores the value from before the run began; it only
 * needs the newest guard.
 */
function collapseTextRun(patches: ResumePatch[]): void {
  while (patches.length > 1) {
    const [newest, next] = patches
    if (
      newest?.op !== "replace_text" ||
      next?.op !== "replace_text" ||
      newest.targetNodeId !== next.targetNodeId ||
      newest.field !== next.field
    ) {
      return
    }
    patches.splice(0, 2, { ...next, before: newest.before })
  }
}

const AUTOSAVE_MS = 800
const MAX_HISTORY = 50
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16_000, 30_000]

/**
 * Owns one open resume: the live document, the undo stack, and autosave.
 *
 * Every mutation, whether a keystroke or an accepted AI suggestion, goes
 * through `apply` as a patch. One mutation path means undo is just the inverse
 * patches `applyPatches` already hands back.
 */
export class ResumeSession {
  readonly store: Store<ResumeState>

  private undoStack: UndoEntry[] = []
  private redoStack: UndoEntry[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  /** Groups consecutive keystrokes on one field into a single undo entry. */
  private lastCoalesceKey: string | null = null
  private retries = 0
  private disposed = false
  /** The save currently in flight, so a second one cannot overlap it. */
  private inFlight: Promise<void> | null = null

  constructor(record: ResumeRecord, conversationId: string) {
    this.store = new Store<ResumeState>({
      resumeId: record.id,
      doc: record.data,
      savedDoc: record.data,
      revision: record.revision,
      updatedAt: record.updatedAt,
      conversationId,
      templateId: record.templateId,
      templateOptions: record.templateOptions,
      saveStatus: "saved",
      selectedNodeId: null,
      previewPatches: [],
      hasFieldErrors: false,
    })
  }

  get state(): ResumeState {
    return this.store.state
  }

  /* --------------------------------------------------------- mutations */

  /**
   * Applies a batch of patches to the live document. Returns the patches that
   * failed so a caller can surface them; a partially applied batch still
   * records one undo entry so Cmd+Z reverses the whole gesture.
   */
  apply(
    patches: ResumePatch[],
    opts: { coalesceKey?: string } = {}
  ): { failed: number } {
    if (patches.length === 0) return { failed: 0 }
    const result = applyPatches(this.state.doc, patches)
    if (result.applied.length === 0) return { failed: result.failed.length }

    // Typing into one field should undo as one edit, not one per keystroke.
    const coalesced =
      opts.coalesceKey !== undefined &&
      opts.coalesceKey === this.lastCoalesceKey
    this.lastCoalesceKey = opts.coalesceKey ?? null

    // Inverses are applied in reverse order to unwind the batch correctly.
    const inverses = result.applied.map((a) => a.inverse).reverse()
    const top = coalesced ? this.undoStack.at(-1) : undefined

    if (top?.kind === "patches") {
      // Merging rather than discarding. Every patch carries a `before` guard,
      // so the inverse already on the stack was built against the text as it
      // stood one keystroke ago and no longer matches: dropping the new
      // inverse would make undo fail silently after the second character.
      // Prepending keeps the run unwinding newest-first, each guard matching
      // what the one before it restored.
      top.patches = [...inverses, ...top.patches]
      collapseTextRun(top.patches)
    } else {
      this.push({ kind: "patches", patches: inverses })
    }
    this.redoStack = []
    this.commit(result.resume)
    return { failed: result.failed.length }
  }

  undo(): boolean {
    return this.step(this.undoStack, this.redoStack)
  }

  redo(): boolean {
    return this.step(this.redoStack, this.undoStack)
  }

  private step(from: UndoEntry[], to: UndoEntry[]): boolean {
    this.lastCoalesceKey = null
    const entry = from.pop()
    if (!entry) return false

    const previous = this.state.doc
    if (entry.kind === "doc") {
      to.push({ kind: "doc", doc: previous })
      this.commit(entry.doc)
      return true
    }

    const result = applyPatches(previous, entry.patches)
    if (result.applied.length === 0) return false
    to.push({
      kind: "patches",
      patches: result.applied.map((a) => a.inverse).reverse(),
    })
    this.commit(result.resume)
    return true
  }

  private push(entry: UndoEntry): void {
    this.undoStack.push(entry)
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift()
  }

  private commit(doc: Resume): void {
    this.store.setState((s) => ({ ...s, doc, saveStatus: "dirty" }))
    this.scheduleSave()
  }

  /**
   * Replaces the whole document as one undoable edit. Used for changes that no
   * single patch can express, such as adding a top-level section.
   */
  replaceDocument(doc: Resume): void {
    if (!ResumeSchema.safeParse(doc).success) return
    this.lastCoalesceKey = null
    this.push({ kind: "doc", doc: this.state.doc })
    this.redoStack = []
    this.commit(doc)
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** Replaces the head wholesale, as after accepting suggestions or restoring. */
  replaceHead(doc: Resume, revision: number, updatedAt: string): void {
    this.lastCoalesceKey = null
    this.undoStack = []
    this.redoStack = []
    this.store.setState((s) => ({
      ...s,
      doc,
      savedDoc: doc,
      revision,
      updatedAt,
      saveStatus: "saved",
    }))
  }

  select(nodeId: string | null): void {
    this.store.setState((s) => ({ ...s, selectedNodeId: nodeId }))
  }

  previewPatches(patches: ResumePatch[]): void {
    this.store.setState((s) => ({ ...s, previewPatches: patches }))
  }

  setFieldErrors(hasErrors: boolean): void {
    if (this.state.hasFieldErrors === hasErrors) return
    this.store.setState((s) => ({ ...s, hasFieldErrors: hasErrors }))
  }

  async setTemplate(
    templateId: TemplateId,
    templateOptions?: TemplateOptions
  ): Promise<void> {
    const options = templateOptions ?? this.state.templateOptions
    this.store.setState((s) => ({ ...s, templateId, templateOptions: options }))
    await setTemplate({
      id: this.state.resumeId,
      templateId,
      templateOptions: options,
    })
  }

  /* ----------------------------------------------------------- autosave */

  private scheduleSave(delay = AUTOSAVE_MS): void {
    if (this.disposed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.save(), delay)
  }

  /** Forces a save now, e.g. before navigating away. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.inFlight
    if (this.state.saveStatus === "saved") return
    await this.save()
  }

  private async save(): Promise<void> {
    if (this.disposed) return

    // Two saves must never overlap. Both would carry the same
    // `expectedRevision`; the first would move the server past it and the
    // second would come back as a conflict the user never caused. Typing for
    // longer than the debounce window is enough to trigger it. Returning here
    // is safe because the save in flight re-schedules itself whenever the
    // document has moved on beneath it.
    if (this.inFlight) return

    const { doc, resumeId, revision, hasFieldErrors } = this.state

    // A document failing its own schema would be rejected anyway; wait for the
    // user to fix the field rather than burning a request and showing an error.
    if (hasFieldErrors || !ResumeSchema.safeParse(doc).success) return

    this.store.setState((s) => ({ ...s, saveStatus: "saving" }))
    const request = updateResume({
      id: resumeId,
      data: doc,
      expectedRevision: revision,
    })
    this.inFlight = request.then(
      () => undefined,
      () => undefined
    )
    try {
      const result = await request
      this.retries = 0
      this.store.setState((s) => ({
        ...s,
        // `doc` may have moved on while the request was in flight.
        savedDoc: doc,
        revision: result.revision,
        updatedAt: result.updatedAt,
        saveStatus: s.doc === doc ? "saved" : "dirty",
      }))
      if (this.state.saveStatus === "dirty") this.scheduleSave()
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        this.store.setState((s) => ({ ...s, saveStatus: "conflict" }))
        return
      }
      this.store.setState((s) => ({ ...s, saveStatus: "error" }))
      const delay =
        BACKOFF_MS[Math.min(this.retries, BACKOFF_MS.length - 1)] ?? 30_000
      this.retries += 1
      this.scheduleSave(delay)
    } finally {
      this.inFlight = null
    }
  }

  /** Conflict recovery: keep the local document and overwrite the server copy. */
  async overwrite(): Promise<void> {
    const result = await updateResume({
      id: this.state.resumeId,
      data: this.state.doc,
    })
    this.store.setState((s) => ({
      ...s,
      savedDoc: s.doc,
      revision: result.revision,
      updatedAt: result.updatedAt,
      saveStatus: "saved",
    }))
  }

  /** Conflict recovery: throw away local edits. */
  discardLocal(record: ResumeRecord): void {
    this.replaceHead(record.data, record.revision, record.updatedAt)
  }

  /**
   * Re-arms a session whose effect was torn down and mounted again.
   *
   * React can disconnect and reconnect passive effects around a component
   * whose memoised values survive, so the same session object can be disposed
   * and then reused. Without this, `disposed` latched on during the first
   * mount and every later autosave returned silently: edits stayed on screen,
   * the status bar sat on "Unsaved changes", and nothing was ever written.
   */
  activate(): void {
    this.disposed = false
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
