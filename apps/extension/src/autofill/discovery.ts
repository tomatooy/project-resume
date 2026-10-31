import type { Option } from "@workspace/autofill/fields"
import { optionState } from "@workspace/autofill/options"
import type { WorkerReply } from "../lib/autofill-protocol"
import { trace } from "./debug"
import { inScriptClick } from "./dom"
import { handleFor } from "./drivers"
import { fieldIdentity } from "./field-identity"
import type { Owner } from "./owner"
import type { ScannedField } from "./types"

type Cached = {
  element: HTMLElement
  identity: string
  optionState: "ready" | "search" | "unavailable"
  options?: Option[]
}

/** One document's discovered labels; menu nodes never enter the cache. */
export function createDiscovery() {
  const cache = new Map<string, Cached>()
  let page: string | null = null
  let generation = 0

  const invalidate = () => {
    generation += 1
    cache.clear()
  }

  const enrich = (
    fields: ScannedField[],
    key: string | null
  ): ScannedField[] => {
    if (page !== key) {
      page = key
      invalidate()
    }
    const ids = new Set(fields.map((field) => field.descriptor.id))
    for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id)
    return fields.map((field) => {
      const stored = cache.get(field.descriptor.id)
      if (!stored) return field
      if (
        stored.element !== field.element ||
        stored.identity !== fieldIdentity(field.descriptor)
      ) {
        cache.delete(field.descriptor.id)
        return field
      }
      return {
        ...field,
        descriptor: {
          ...field.descriptor,
          optionState: stored.optionState,
          ...(stored.options ? { options: stored.options } : {}),
        },
      }
    })
  }

  const prepareFields = async (
    read: () => ScannedField[],
    owner: Owner,
    retry: boolean,
    current: () => boolean
  ): Promise<WorkerReply<"autofill-prepare">["outcomes"]> => {
    const started = Date.now()
    const focus = document.activeElement
    let interrupted = false
    let hits = 0
    const outcomes: WorkerReply<"autofill-prepare">["outcomes"] = {}
    const interrupt = (event: Event) => {
      if (event.isTrusted && !inScriptClick()) interrupted = true
    }
    const events = ["pointerdown", "keydown", "input", "change"]
    for (const event of events)
      document.addEventListener(event, interrupt, true)
    try {
      if (retry) {
        for (const [id, entry] of cache) {
          if (entry.optionState === "unavailable") cache.delete(id)
        }
      }
      const initial = read()
      for (const expected of initial) {
        const id = expected.descriptor.id
        if (interrupted || !current()) {
          outcomes[id] = "interrupted"
          break
        }
        const field = read().find((item) => item.descriptor.id === id)
        if (
          !field ||
          fieldIdentity(field.descriptor) !== fieldIdentity(expected.descriptor)
        )
          continue
        const handle = handleFor(field)
        if (
          owner.isOwned(id) ||
          handle.hasValue() ||
          field.combo?.input.value.trim()
        ) {
          outcomes[id] = "skipped"
          continue
        }
        const state = optionState(field.descriptor)
        if (state !== "pending") {
          if (state === "ready") {
            outcomes[id] = cache.has(id) ? "cached" : "ready"
            if (cache.has(id)) hits += 1
          } else if (state) outcomes[id] = state
          continue
        }
        const before = generation
        const cancelled = () =>
          interrupted ||
          !current() ||
          generation !== before ||
          owner.isOwned(id) ||
          !field.element.isConnected
        const listed = await handle.readOptions(cancelled).catch(() => null)
        if (cancelled()) {
          outcomes[id] = "interrupted"
          break
        }
        const next = read().find((item) => item.descriptor.id === id)
        if (
          !next ||
          next.element !== field.element ||
          fieldIdentity(next.descriptor) !== fieldIdentity(field.descriptor)
        )
          continue
        const discovered: Cached["optionState"] = listed?.length
          ? "ready"
          : field.descriptor.searchable && !field.combo?.input.readOnly
            ? "search"
            : "unavailable"
        cache.set(id, {
          element: field.element,
          identity: fieldIdentity(field.descriptor),
          optionState: discovered,
          ...(listed?.length ? { options: listed } : {}),
        })
        outcomes[id] = discovered
      }
    } finally {
      for (const event of events)
        document.removeEventListener(event, interrupt, true)
      if (
        !interrupted &&
        current() &&
        focus instanceof HTMLElement &&
        focus.isConnected
      )
        focus.focus({ preventScroll: true })
    }
    trace("prepared fields", {
      durationMs: Date.now() - started,
      cacheHits: hits,
      ready: Object.values(outcomes).filter((state) => state === "ready")
        .length,
      unavailable: Object.values(outcomes).filter(
        (state) => state === "unavailable"
      ).length,
      interrupted,
    })
    return outcomes
  }

  return { enrich, invalidate, prepareFields }
}
