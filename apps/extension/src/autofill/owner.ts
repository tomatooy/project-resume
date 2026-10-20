import { inScriptClick } from "./dom"

/**
 * The fields the user owns, which are never written again: ones they edited
 * or cleared, and ones that gained a value we did not write.
 */
export type Owner = {
  /** Called before our write, so the value it leaves is not taken as theirs. */
  markOurs(id: string): void
  /** Called when our write did not happen. */
  release(id: string): void
  isOurs(id: string): boolean
  isOwned(id: string): boolean
  own(ids: string[]): void
  /** Owns the field of each trusted `input` or `change` under `root`. */
  watch(
    root: Element,
    idOf: (target: EventTarget | null) => string | null
  ): () => void
  /** Owns fields that went from empty to a value we did not write. */
  noteScan(fields: { id: string; hasValue: boolean }[]): void
}

export function createOwner(options: {
  report: (fieldIds: string[]) => void
  isTrusted?: (event: Event) => boolean
  debounceMs?: number
}): Owner {
  const isTrusted = options.isTrusted ?? ((event: Event) => event.isTrusted)
  const debounceMs = options.debounceMs ?? 300
  const ours = new Set<string>()
  const owned = new Set<string>()
  let unreported: string[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let seen = new Map<string, boolean>()

  const flush = () => {
    timer = undefined
    const ids = unreported
    unreported = []
    if (ids.length > 0) options.report(ids)
  }

  // Each id is reported once, batched with the others owned meanwhile.
  const own = (ids: string[]) => {
    for (const id of ids) {
      if (owned.has(id)) continue
      owned.add(id)
      unreported.push(id)
    }
    if (unreported.length > 0 && timer === undefined)
      timer = setTimeout(flush, debounceMs)
  }

  return {
    markOurs: (id) => {
      ours.add(id)
    },
    release: (id) => {
      ours.delete(id)
    },
    isOurs: (id) => ours.has(id),
    isOwned: (id) => owned.has(id),
    own,
    watch(root, idOf) {
      const onEdit = (event: Event) => {
        // A driver's click fires trusted events of its own.
        if (inScriptClick() || !isTrusted(event)) return
        const id = idOf(event.target)
        if (id !== null) own([id])
      }
      root.addEventListener("input", onEdit, true)
      root.addEventListener("change", onEdit, true)
      return () => {
        root.removeEventListener("input", onEdit, true)
        root.removeEventListener("change", onEdit, true)
      }
    },
    // A value present at the first sight of a field is the page's own.
    noteScan(fields) {
      const appeared = fields.filter(
        ({ id, hasValue }) =>
          hasValue && seen.get(id) === false && !ours.has(id)
      )
      seen = new Map(fields.map(({ id, hasValue }) => [id, hasValue]))
      own(appeared.map(({ id }) => id))
    },
  }
}
