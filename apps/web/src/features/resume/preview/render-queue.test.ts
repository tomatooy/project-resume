import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { defaultTemplateOptions } from "@workspace/resume-schema"
import { createPreviewStore } from "./preview-store"
import { PreviewRenderQueue, type PreviewInput } from "./render-queue"

const input: PreviewInput = {
  doc: {
    schemaVersion: 1,
    basics: { id: "basics", name: "Jo", links: [] },
    sections: [],
  },
  templateId: "lisbon",
  options: defaultTemplateOptions,
  patches: [],
}
const edited = (name: string): PreviewInput => ({
  ...input,
  doc: { ...input.doc, basics: { ...input.doc.basics, name } },
})
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
describe("on-demand PDF rendering", () => {
  it("does no work while hidden and renders only the latest input on reopening", async () => {
    const store = createPreviewStore()
    const render = vi.fn(async () => new Blob(["pdf"]))
    const queue = new PreviewRenderQueue(store, render)
    queue.update(input, false)
    queue.update(edited("First edit"), false)
    const latest = edited("Last edit")
    queue.update(latest, false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(render).not.toHaveBeenCalled()
    expect(store.state).toMatchObject({
      stale: true,
      pageCount: null,
      loading: false,
    })
    queue.update(latest, true)
    await vi.advanceTimersByTimeAsync(300)
    expect(render).toHaveBeenCalledExactlyOnceWith(latest)
    expect(store.state.stale).toBe(false)
    queue.dispose()
  })
  it("serializes renders, discards obsolete completions, and retains the old blob", async () => {
    const store = createPreviewStore()
    const old = new Blob(["old"])
    store.setState((s) => ({
      ...s,
      blob: old,
      renderedInput: input,
      stale: false,
      pageCount: 1,
    }))
    const finish: Array<(blob: Blob) => void> = []
    const render = vi.fn(
      () => new Promise<Blob>((resolve) => finish.push(resolve))
    )
    const queue = new PreviewRenderQueue(store, render)
    queue.update(edited("First"), true)
    await vi.advanceTimersByTimeAsync(300)
    queue.update(edited("Latest"), true)
    await vi.advanceTimersByTimeAsync(300)
    expect(render).toHaveBeenCalledTimes(1)
    expect(store.state.blob).toBe(old)
    expect(store.state.stale).toBe(true)
    finish[0]?.(new Blob(["outdated"]))
    await vi.advanceTimersByTimeAsync(0)
    expect(render).toHaveBeenCalledTimes(2)
    expect(store.state.blob).toBe(old)
    const latest = new Blob(["latest"])
    finish[1]?.(latest)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.state).toMatchObject({
      blob: latest,
      loading: false,
      stale: false,
    })
    queue.dispose()
  })
  it("cancels pending work when hidden and reuses an unchanged successful PDF", async () => {
    const store = createPreviewStore()
    const render = vi.fn(async () => new Blob())
    const queue = new PreviewRenderQueue(store, render)
    queue.update(input, true)
    queue.update(input, false)
    await vi.advanceTimersByTimeAsync(300)
    expect(render).not.toHaveBeenCalled()
    queue.update(input, true)
    await vi.advanceTimersByTimeAsync(300)
    queue.update(input, false)
    queue.update(input, true)
    await vi.advanceTimersByTimeAsync(300)
    expect(render).toHaveBeenCalledTimes(1)
    queue.dispose()
  })
  it("keeps the last PDF stale after a render failure", async () => {
    const store = createPreviewStore()
    const queue = new PreviewRenderQueue(store, async () => {
      throw new Error("layout failed")
    })
    queue.update(input, true)
    await vi.advanceTimersByTimeAsync(300)
    expect(store.state).toMatchObject({
      stale: true,
      loading: false,
      error: "layout failed",
    })
    queue.dispose()
  })
})

it("reuses cached measurement when an edit is undone before rendering", async () => {
  const store = createPreviewStore()
  store.setState((s) => ({
    ...s,
    blob: new Blob(),
    renderedInput: input,
    stale: false,
    pageCount: 2,
  }))
  const render = vi.fn(async () => new Blob())
  const queue = new PreviewRenderQueue(store, render)
  queue.update(edited("Changed"), true)
  queue.update(input, true)
  await vi.advanceTimersByTimeAsync(300)
  expect(render).not.toHaveBeenCalled()
  expect(store.state).toMatchObject({
    stale: false,
    loading: false,
    pageCount: 2,
  })
  queue.dispose()
})
