import { Store } from "@tanstack/store"
import {
  ProfileSectionSchema,
  ProfileUpdateSchema,
  emptyProfile,
  type AutofillProfile,
  type ProfileData,
  type ProfileSection,
  type ProfileUpdate,
} from "@workspace/resume-core/contracts"

type State = {
  saved: AutofillProfile
  draft: ProfileData
  busy: boolean
  error: string | null
  conflict: AutofillProfile | null
  dirty: boolean
}
export class ProfileEditor {
  readonly store: Store<State>
  private pending: Promise<void> | null = null
  constructor(
    initial: AutofillProfile,
    private readonly write: (input: ProfileUpdate) => Promise<AutofillProfile>,
    private readonly read: () => Promise<AutofillProfile>
  ) {
    this.store = new Store<State>({
      saved: initial,
      draft: structuredClone(initial.data),
      busy: false,
      error: null,
      conflict: null,
      dirty: false,
    })
  }
  set<K extends ProfileSection>(section: K, data: ProfileData[K]) {
    this.store.setState((s) => {
      const draft = { ...s.draft, [section]: data }
      return {
        ...s,
        draft,
        dirty: JSON.stringify(draft) !== JSON.stringify(s.saved.data),
      }
    })
  }
  clear(section: ProfileSection) {
    this.set(section, emptyProfile().data[section])
  }
  discard(section?: ProfileSection) {
    this.store.setState((s) => {
      const draft = section
        ? { ...s.draft, [section]: structuredClone(s.saved.data[section]) }
        : structuredClone(s.saved.data)
      return {
        ...s,
        draft,
        error: null,
        conflict: null,
        dirty: JSON.stringify(draft) !== JSON.stringify(s.saved.data),
      }
    })
  }
  reconcile() {
    this.store.setState((s) => {
      if (!s.conflict) return s
      let draft = s.draft
      for (const section of ProfileSectionSchema.options) {
        if (
          JSON.stringify(draft[section]) ===
          JSON.stringify(s.saved.data[section])
        )
          draft = { ...draft, [section]: s.conflict.data[section] }
      }
      return {
        ...s,
        draft,
        saved: s.conflict,
        conflict: null,
        error: null,
        dirty: JSON.stringify(draft) !== JSON.stringify(s.conflict.data),
      }
    })
  }
  save(section?: ProfileSection): Promise<void> {
    if (this.pending) return this.pending.then(() => this.save(section))
    if (this.store.state.conflict)
      return Promise.reject(
        new Error("Review the latest saved information first.")
      )
    this.pending = this.commit(section).finally(() => {
      this.pending = null
      this.store.setState((s) => ({ ...s, busy: false }))
    })
    return this.pending
  }
  private async commit(section?: ProfileSection) {
    this.store.setState((s) => ({ ...s, busy: true, error: null }))
    try {
      for (const key of section ? [section] : ProfileSectionSchema.options) {
        const state = this.store.state
        if (
          JSON.stringify(state.draft[key]) ===
          JSON.stringify(state.saved.data[key])
        )
          continue
        const checked = ProfileUpdateSchema.safeParse({
          section: key,
          data: state.draft[key],
          expectedRevision: state.saved.revision,
        })
        if (!checked.success)
          throw new Error(
            checked.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")
          )
        const result = await this.write(checked.data)
        this.store.setState((s) => {
          const draft =
            JSON.stringify(s.draft[key]) === JSON.stringify(checked.data.data)
              ? { ...s.draft, [key]: result.data[key] }
              : s.draft
          return {
            ...s,
            saved: result,
            draft,
            dirty: JSON.stringify(draft) !== JSON.stringify(result.data),
          }
        })
      }
    } catch (error) {
      const conflict =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "CONFLICT"
          ? await this.read().catch(() => null)
          : null
      this.store.setState((s) => ({
        ...s,
        conflict,
        error:
          error instanceof Error
            ? error.message
            : "Could not save. Your draft is preserved.",
      }))
      throw error
    }
  }
}
