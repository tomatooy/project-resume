import type { Fill, Option } from "@workspace/autofill/fields"
import {
  compatibleLocation,
  locationQueries,
  locationTarget,
  matchLocation,
} from "@workspace/autofill/location"
import { comboOptionLabel, openCombo, setComboQuery } from "./combobox"
import { waitFor } from "./dom"
import type { ComboParts, ResolveLocation } from "./types"

type SearchFill = Extract<Fill, { kind: "search" }>
export type SearchResult =
  | { interrupted: true }
  | { interrupted: false; label: string }
const SEARCH_MS = 5_000
const STABLE_MS = 200
const MAX_OPTIONS = 20

/** A fresh, settled result set for this query, never a previous query's menu. */
async function search(
  parts: ComboParts,
  query: string,
  cancelled: () => boolean
): Promise<Option[] | null> {
  if (cancelled()) return null
  const previous = parts.options()
  const signature = (options: HTMLElement[]) =>
    JSON.stringify(options.map((option) => comboOptionLabel(parts, option)))
  const before = signature(previous)
  let fresh = previous.length === 0 || parts.input.value === query
  let changed = false
  let last = ""
  let since = Date.now()
  parts.input.focus()
  setComboQuery(parts, query)
  await openCombo(parts, 0, cancelled)
  const options = await waitFor(() => {
    if (cancelled()) return []
    if (parts.input.value !== query) {
      changed = true
      return []
    }
    const shown = parts.options()
    if (parts.loading?.() || parts.input.getAttribute("aria-busy") === "true") {
      fresh = true
      last = ""
      return null
    }
    if (!shown.length) {
      fresh = true
      last = ""
      return null
    }
    const next = signature(shown)
    fresh ||=
      next !== before || shown.some((option, i) => option !== previous[i])
    if (!fresh) return null
    if (next !== last) {
      last = next
      since = Date.now()
    }
    if (Date.now() - since < STABLE_MS) return null
    if (shown.length > MAX_OPTIONS) return []
    const labels = shown.map((option) => comboOptionLabel(parts, option))
    return labels.some((label) => !label)
      ? []
      : labels.map((label, i) => ({ id: `#${i + 1}`, label }))
  }, SEARCH_MS)
  return cancelled() || changed ? null : (options ?? [])
}

export async function findLocation(
  parts: ComboParts,
  fill: SearchFill,
  cancelled: () => boolean,
  resolve?: ResolveLocation
): Promise<SearchResult | null> {
  const target = fill.location ?? locationTarget(fill.target)
  if (!target) return null
  const maxLength = parts.input.maxLength > 0 ? parts.input.maxLength : 200
  let candidates: Option[] = []
  let query = ""
  for (const next of locationQueries(target).filter(
    (value) => value.length <= maxLength
  )) {
    query = next
    const options = await search(parts, query, cancelled)
    if (!options) return { interrupted: true }
    if (fill.selection) {
      const saved = options.filter(
        ({ label }) =>
          label === fill.selection && compatibleLocation(target, label)
      )
      if (saved.length === 1 && saved[0])
        return { interrupted: false, label: saved[0].label }
      continue
    }
    const index = matchLocation(
      target,
      options.map(({ label }) => label)
    )
    const exact = index === null ? undefined : options[index]
    if (exact) return { interrupted: false, label: exact.label }
    candidates = options.filter(({ label }) =>
      compatibleLocation(target, label)
    )
    if (candidates.length) break
  }
  if (fill.selection || !candidates.length || !resolve || cancelled())
    return null
  const picked = await resolve(fill.fieldId, candidates).catch(() => null)
  if (cancelled() || parts.input.value !== query) return { interrupted: true }
  if (
    !picked ||
    !candidates.some(
      ({ id, label }) => id === picked.id && label === picked.label
    )
  )
    return null
  // The list can refresh while Jev runs; reacquire it before choosing.
  const live = parts
    .options()
    .filter((option) => comboOptionLabel(parts, option) === picked.label)
  if (live.length !== 1 || parts.loading?.()) {
    const refreshed = await search(parts, query, cancelled)
    if (!refreshed) return { interrupted: true }
    if (refreshed.filter(({ label }) => label === picked.label).length !== 1)
      return null
  }
  return { interrupted: false, label: picked.label }
}
