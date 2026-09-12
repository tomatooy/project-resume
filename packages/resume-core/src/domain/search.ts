import {
  breadcrumb,
  indexNodes,
  readField,
  textFields,
  type Resume,
} from "@workspace/resume-schema"

import type { ResumeSummary } from "./resume"

/**
 * Text search over a resume, for the rail.
 *
 * The walk reads fields, never writes them: `textFields` lists what a patch may
 * rewrite, and the two fields added below are read here because a city and a
 * project link are text the user typed too, even though no patch reaches them.
 */

/** `[start, end)` offsets into the string the range was measured on. */
export type TextRange = [number, number]

export type SearchableField = {
  nodeId: string
  field: string
  /** The single chip, bullet, or field value this entry stands for. */
  text: string
}

export type DocumentHit = {
  nodeId: string
  field: string
  breadcrumb: string
  snippet: string
  /** Offsets into `snippet`, shifted to its own start. */
  ranges: TextRange[]
}

export type ResumeSearchHit = DocumentHit

export type ResumeSearchGroup = {
  resume: ResumeSummary
  /** Title hits, which put this resume in the relevance tier above the rest. */
  titleRanges: TextRange[]
  /** Capped at `HITS_PER_RESUME`; `totalHits` is the uncapped count. */
  hits: ResumeSearchHit[]
  totalHits: number
}

export type ResumeSearch = {
  groups: ResumeSearchGroup[]
  /** How many resumes the query looked at, for the "3 of 12" line. */
  scanned: number
}

export const HITS_PER_RESUME = 3
export const MAX_SEARCH_RESULTS = 20
export const MIN_SEARCH_LENGTH = 2

/** Context on either side of a hit. Deliberately short in front: the rail
 *  column is about 30 characters wide, so a long lead would push the hit out
 *  of view and the row would look like a plain text quote. */
const LEAD = 16
const TRAIL = 44
const ELLIPSIS = "..."

/** Item fields the search reads that `replace_text` may not target. */
const ITEM_EXTRA_FIELDS = ["location", "url"] as const

/** Trim, split on spaces, lowercase, dedupe. Empty input yields no tokens. */
export function tokenize(query: string): string[] {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase())
  return [...new Set(tokens)]
}

/**
 * Every searchable string in the document, in document order.
 *
 * Skills are the one node whose text is an array, so each chip is its own
 * entry: a hit has to name the chip, and `textFields` cannot see into a list.
 */
export function searchableFields(doc: Resume): SearchableField[] {
  const found: SearchableField[] = []
  for (const ref of indexNodes(doc).values()) {
    if (ref.kind === "section") continue

    if (ref.kind === "item" && ref.node.kind === "skills") {
      for (const skill of ref.node.skills) {
        found.push({ nodeId: ref.id, field: "skills", text: skill })
      }
      continue
    }

    const names =
      ref.kind === "item"
        ? [...textFields(ref.kind, ref.node), ...ITEM_EXTRA_FIELDS]
        : textFields(ref.kind, ref.node)
    for (const field of names) {
      const value = readField(ref.node, field)
      if (typeof value === "string" && value.length > 0) {
        found.push({ nodeId: ref.id, field, text: value })
      }
    }
  }
  return found
}

/** Case-insensitive substring matches, sorted and merged where they touch. */
export function matchTokens(text: string, tokens: string[]): TextRange[] {
  if (text.length === 0 || tokens.length === 0) return []
  const haystack = text.toLowerCase()
  const found: TextRange[] = []
  for (const token of tokens) {
    if (token.length === 0) continue
    let at = haystack.indexOf(token)
    while (at !== -1) {
      found.push([at, at + token.length])
      at = haystack.indexOf(token, at + token.length)
    }
  }
  return mergeRanges(found)
}

export function mergeRanges(ranges: TextRange[]): TextRange[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: TextRange[] = []
  for (const [start, end] of sorted) {
    const last = merged.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

/**
 * A one-line window around the first hit, with every later hit that lands
 * inside the window shifted to the snippet's own offsets.
 *
 * `ranges` is what `matchTokens` returns: sorted and merged, so the first entry
 * is the earliest hit and the window starts at it. Ranges past the window end
 * are dropped; one that runs past it is clipped.
 */
export function makeSnippet(
  text: string,
  ranges: TextRange[]
): { snippet: string; ranges: TextRange[] } {
  const first = ranges[0]
  const from = Math.max(0, (first?.[0] ?? 0) - LEAD)
  const to = Math.min(text.length, (first?.[1] ?? 0) + TRAIL)
  const lead = from > 0 ? ELLIPSIS : ""
  const tail = to < text.length ? ELLIPSIS : ""

  const shifted: TextRange[] = []
  for (const [start, end] of ranges) {
    if (start >= to) continue
    shifted.push([
      start - from + lead.length,
      Math.min(end, to) - from + lead.length,
    ])
  }

  return { snippet: `${lead}${text.slice(from, to)}${tail}`, ranges: shifted }
}

/**
 * Every hit in one document, or none.
 *
 * The AND is document-level, not field-level: two tokens may sit in different
 * bullets and still be one match, which is the only reading that makes a
 * multi-word query useful.
 */
export function matchDocument(doc: Resume, tokens: string[]): DocumentHit[] {
  if (tokens.length === 0) return []
  const fields = searchableFields(doc)
  const everywhere = tokens.every((token) =>
    fields.some((field) => field.text.toLowerCase().includes(token))
  )
  if (!everywhere) return []

  const hits: DocumentHit[] = []
  for (const field of fields) {
    const ranges = matchTokens(field.text, tokens)
    if (ranges.length === 0) continue
    const snippet = makeSnippet(field.text, ranges)
    hits.push({
      nodeId: field.nodeId,
      field: field.field,
      breadcrumb: breadcrumb(doc, field.nodeId),
      snippet: snippet.snippet,
      ranges: snippet.ranges,
    })
  }
  return hits
}
