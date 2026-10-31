import type { Fill, Option } from "@workspace/autofill/fields"
import { normalizeText } from "@workspace/autofill/match"
import {
  compatibleLocation,
  locationQueries,
  locationTarget,
  matchLocation,
} from "@workspace/autofill/location"
import {
  candidateElement,
  comboOptions,
  openCombo,
  sameCandidate,
  setComboQuery,
} from "./combobox"
import { waitFor } from "./dom"
import type { ComboParts, ResolveSearch } from "./types"

type SearchFill = Extract<Fill, { kind: "search" }>
export type SearchResult =
  | { interrupted: true }
  | { interrupted: false; option: Option }
const SEARCH_MS = 5_000
const STABLE_MS = 200
const MAX_OPTIONS = 20

function exactMatch(target: string, labels: readonly string[]): number | null {
  const wanted = normalizeText(target)
  if (!wanted) return null
  const matches = labels.flatMap((label, index) =>
    normalizeText(label) === wanted ? [index] : []
  )
  return matches.length === 1 ? (matches[0] ?? null) : null
}

/** A fresh, settled result set for this query, never a previous query's menu. */
async function search(
  parts: ComboParts,
  query: string,
  cancelled: () => boolean
): Promise<Option[] | null> {
  if (cancelled()) return null
  const previous = parts.options()
  const before = JSON.stringify(comboOptions(parts))
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
    const candidates = comboOptions(parts)
    const next = JSON.stringify(candidates)
    fresh ||=
      next !== before || shown.some((option, i) => option !== previous[i])
    if (!fresh) return null
    if (next !== last) {
      last = next
      since = Date.now()
    }
    if (Date.now() - since < STABLE_MS) return null
    if (shown.length > MAX_OPTIONS) return []
    return candidates.some(({ label }) => !label) ? [] : candidates
  }, SEARCH_MS)
  return cancelled() || changed ? null : (options ?? [])
}

export async function findSearch(
  parts: ComboParts,
  fill: SearchFill,
  cancelled: () => boolean,
  resolve?: ResolveSearch
): Promise<SearchResult | null> {
  const target =
    fill.location ?? (parts.location ? locationTarget(fill.target) : null)
  if ((parts.location || fill.location) && !target) return null
  const maxLength = parts.input.maxLength > 0 ? parts.input.maxLength : 200
  let candidates: Option[] = []
  let query = ""
  for (const next of (target ? locationQueries(target) : [fill.query]).filter(
    (value) => value.length <= maxLength
  )) {
    query = next
    const options = await search(parts, query, cancelled)
    if (!options) return { interrupted: true }
    if (fill.selection) {
      const saved = options.filter(
        ({ label, description }) =>
          label === fill.selection &&
          description === fill.selectionDescription &&
          (!target || compatibleLocation(target, label))
      )
      if (saved.length === 1 && saved[0])
        return { interrupted: false, option: saved[0] }
      continue
    }
    const labels = options.map(({ label }) => label)
    const index = target
      ? matchLocation(target, labels)
      : exactMatch(fill.target, labels)
    const exact = index === null ? undefined : options[index]
    if (exact) return { interrupted: false, option: exact }
    candidates = options.filter(
      ({ label }) => !target || compatibleLocation(target, label)
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
      (option) => option.id === picked.id && sameCandidate(option, picked)
    )
  )
    return null
  // The list can refresh while Jev runs; reacquire it before choosing.
  if (!candidateElement(parts, picked) || parts.loading?.()) {
    const refreshed = await search(parts, query, cancelled)
    if (!refreshed) return { interrupted: true }
    if (
      refreshed.filter((option) => sameCandidate(option, picked)).length !== 1
    )
      return null
  }
  return { interrupted: false, option: picked }
}
