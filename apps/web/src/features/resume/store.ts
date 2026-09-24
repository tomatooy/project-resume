import { Store } from "@tanstack/store"
import {
  applyDraft,
  documentErrors,
  type DocumentValidity,
  type Resume,
  type ResumePatch,
} from "@workspace/resume-schema"
import type { TemplateId, TemplateOptions } from "@workspace/resume-render"

import * as api from "@/lib/api"
import { ApiError, type ResumeRecord } from "@/lib/types"
import { AutoSaver, type Clock, type SaveResult } from "./auto-saver"

/**
 * The two calls a session makes on its own initiative. Taken as a dependency
 * rather than imported so a test can hand in a fake and drive the whole
 * session, conflict and all, without mocking the module.
 */
export type SessionApi = Pick<typeof api, "updateResume" | "setTemplate">

export type SessionOptions = {
  api?: SessionApi
  clock?: Clock
}

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
  /**
   * Field errors and savability for `doc`, recomputed with it. Panes read the
   * errors; autosave reads `savable`. One parse, so the save bar cannot say
   * the document is fine while a field is red, or the reverse.
   */
  validity: DocumentValidity
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

const MAX_HISTORY = 50

/**
 * Owns one open resume: the live document, the undo stack, and autosave.
 *
 * Every mutation, whether a keystroke or an accepted AI suggestion, goes
 * through `apply` as a patch. One mutation path means undo is just the inverse
 * patches `applyDraft` already hands back.
 */
export class ResumeSession {
  readonly store: Store<ResumeState>
  private pendingWrites = new Set<Promise<void>>()

  get hasPendingWrites(): boolean {
    return this.pendingWrites.size > 0
  }

  track<T>(write: Promise<T>): Promise<T> {
    const pending = write.then(() => undefined)
    this.pendingWrites.add(pending)
    void pending.then(
      () => this.pendingWrites.delete(pending),
      () => this.pendingWrites.delete(pending)
    )
    return write
  }

  async settled(): Promise<void> {
    await Promise.all(this.pendingWrites)
  }

  private undoStack: UndoEntry[] = []
  private redoStack: UndoEntry[] = []
  /** Groups consecutive keystrokes on one field into a single undo entry. */
  private lastCoalesceKey: string | null = null
  private readonly saver: AutoSaver
  private readonly api: SessionApi

  constructor(
    record: ResumeRecord,
    conversationId: string,
    opts: SessionOptions = {}
  ) {
    this.api = opts.api ?? api
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
      validity: documentErrors(record.data),
    })

    this.saver = new AutoSaver({
      write: () => this.write(),
      // A document failing its own schema would be rejected anyway; wait for
      // the user to fix the field rather than burning a request. `validity`
      // moved with `doc`, so the fields went red the moment it broke.
      shouldWrite: () =>
        this.state.saveStatus !== "saved" && this.state.validity.savable,
      clock: opts.clock,
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
    // `applyDraft`: a keystroke lands in the document as it is typed, so a
    // field is empty or half-formed for as long as it takes to retype it.
    // Refusing those states rejects the patch, leaves `doc` untouched, and the
    // controlled input re-renders with the character the user just deleted.
    // Whether the document is whole is decided in `save`, not here.
    const result = applyDraft(this.state.doc, patches)
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

    const result = applyDraft(previous, entry.patches)
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
    this.store.setState((s) => ({
      ...s,
      doc,
      validity: documentErrors(doc),
      saveStatus: "dirty",
    }))
    this.saver.schedule()
  }

  /**
   * Replaces the whole document as one undoable edit. Used for changes that no
   * single patch can express, such as adding a top-level section.
   */
  replaceDocument(doc: Resume): void {
    // Deliberately unguarded by the document schema. Callers build the
    // replacement from the live document, which is allowed to be mid-edit, so
    // a whole-document check here would silently drop the gesture whenever a
    // field happened to be empty. `save` is the gate that matters.
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
      validity: documentErrors(doc),
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

  async setTemplate(
    templateId: TemplateId,
    templateOptions?: TemplateOptions
  ): Promise<void> {
    const options = templateOptions ?? this.state.templateOptions
    this.store.setState((s) => ({ ...s, templateId, templateOptions: options }))
    await this.track(
      this.api.setTemplate({
        id: this.state.resumeId,
        templateId,
        templateOptions: options,
      })
    )
  }

  /* ----------------------------------------------------------- autosave */

  /** Forces a save now, e.g. before navigating away. */
  async flush(): Promise<void> {
    await this.saver.flush()
  }

  /**
   * One write. `AutoSaver` decides when this runs and what a failure costs;
   * everything here is about the document and the server.
   */
  private async write(): Promise<SaveResult> {
    const { doc, resumeId, revision } = this.state
    this.store.setState((s) => ({ ...s, saveStatus: "saving" }))

    try {
      const result = await this.api.updateResume({
        id: resumeId,
        data: doc,
        expectedRevision: revision,
      })
      this.store.setState((s) => ({
        ...s,
        savedDoc: doc,
        revision: result.revision,
        updatedAt: result.updatedAt,
        // `doc` may have moved on while the request was in flight.
        saveStatus: s.doc === doc ? "saved" : "dirty",
      }))
      return "ok"
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        this.store.setState((s) => ({ ...s, saveStatus: "conflict" }))
        return "conflict"
      }
      this.store.setState((s) => ({ ...s, saveStatus: "error" }))
      return "retry"
    }
  }

  /** Conflict recovery: keep the local document and overwrite the server copy. */
  async overwrite(): Promise<void> {
    const result = await this.api.updateResume({
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
   * and then reused. Without this, autosave stayed off after the first mount:
   * edits stayed on screen, the status bar sat on "Unsaved changes", and
   * nothing was ever written.
   */
  activate(): void {
    this.saver.activate()
  }

  dispose(): void {
    this.saver.dispose()
  }
}
