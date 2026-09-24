import { Store } from "@tanstack/store"
import { UserSkillInputSchema, type SkillDraft } from "@workspace/resume-core"

export const BLANK_SKILL: SkillDraft = {
  category: "editor",
  name: "",
  description: "",
  body: "",
}

type SkillEditorState = {
  fields: SkillDraft
  submitted: boolean
  busy: boolean
  dirty: boolean
}
type SaveSkill = (fields: SkillDraft, skillId?: string) => Promise<string>

/** Drafts outlive their form, but never leave this browser's memory. */
export class SkillEditor {
  readonly store: Store<SkillEditorState>
  private saved: string
  private pending: Promise<string> | null = null

  constructor(
    initial: SkillDraft,
    public skillId?: string
  ) {
    this.saved = JSON.stringify(initial)
    this.store = new Store({
      fields: initial,
      submitted: false,
      busy: false,
      dirty: false,
    })
  }

  replace(fields: SkillDraft): void {
    this.store.setState((s) => ({
      ...s,
      fields,
      dirty: JSON.stringify(fields) !== this.saved,
    }))
  }

  set<K extends keyof SkillDraft>(key: K, value: SkillDraft[K]): void {
    this.replace({ ...this.store.state.fields, [key]: value })
  }

  save(write: SaveSkill): Promise<string> {
    if (this.pending) return this.pending
    this.store.setState((s) => ({ ...s, submitted: true }))
    const parsed = UserSkillInputSchema.safeParse(this.store.state.fields)
    if (!parsed.success)
      return Promise.reject(new Error("Fix the skill's errors before saving."))
    this.store.setState((s) => ({ ...s, busy: true }))
    this.pending = write(parsed.data, this.skillId)
      .then((id) => {
        this.skillId = id
        this.saved = JSON.stringify(parsed.data)
        this.store.setState((s) => ({
          ...s,
          fields: parsed.data,
          dirty: false,
        }))
        return id
      })
      .finally(() => {
        this.pending = null
        this.store.setState((s) => ({ ...s, busy: false }))
      })
    return this.pending
  }

  async settled(): Promise<void> {
    await this.pending
  }
}
