import type {
  Resume,
  ResumePatch,
  TemplateId,
  TemplateOptions,
} from "@workspace/resume-schema"
import type { PreviewStore } from "./preview-store"

export type PreviewInput = {
  doc: Resume
  templateId: TemplateId
  options: TemplateOptions
  patches: ResumePatch[]
}
export function samePreview(a: PreviewInput | null, b: PreviewInput): boolean {
  return (
    a?.doc === b.doc &&
    a.templateId === b.templateId &&
    a.options === b.options &&
    a.patches === b.patches
  )
}

/** Coalesces edits while a non-cancellable PDF render is running. */
export class PreviewRenderQueue {
  private input: PreviewInput | null = null
  private active = false
  private disposed = false
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(
    private readonly store: PreviewStore,
    private readonly render: (input: PreviewInput) => Promise<Blob>
  ) {}

  update(input: PreviewInput, active: boolean): void {
    const changed = !this.input || !samePreview(this.input, input)
    const activated = active && !this.active
    this.input = input
    this.active = active
    const stale = !samePreview(this.store.state.renderedInput, input)
    if (changed)
      this.store.setState((s) => ({
        ...s,
        stale,
        error: null,
      }))
    if (!active || !stale) {
      this.clearTimer()
      this.store.setState((s) => ({ ...s, loading: false }))
    } else if (stale && (changed || activated)) {
      this.clearTimer()
      this.store.setState((s) => ({ ...s, loading: true }))
      this.timer = setTimeout(() => {
        this.timer = null
        void this.run()
      }, 300)
    }
  }
  dispose(): void {
    this.disposed = true
    this.active = false
    this.clearTimer()
  }
  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
  private async run(): Promise<void> {
    const input = this.input
    if (
      this.disposed ||
      !this.active ||
      this.running ||
      !input ||
      samePreview(this.store.state.renderedInput, input)
    )
      return
    this.running = true
    try {
      const blob = await this.render(input)
      if (!this.disposed && this.input && samePreview(input, this.input))
        this.store.setState((s) => ({
          ...s,
          blob,
          renderedInput: input,
          pageCount: null,
          stale: false,
          loading: false,
          error: null,
        }))
    } catch (error) {
      if (!this.disposed && this.input && samePreview(input, this.input))
        this.store.setState((s) => ({
          ...s,
          loading: false,
          error:
            error instanceof Error ? error.message : "PDF rendering failed",
        }))
    } finally {
      this.running = false
      if (
        !this.disposed &&
        this.active &&
        this.input &&
        !samePreview(input, this.input) &&
        !this.timer
      )
        void this.run()
    }
  }
}
