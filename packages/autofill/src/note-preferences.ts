import { normalizeText } from "./match"

export type NotePreferenceMatch = {
  note: string
  preference: string
  option: string
}

/** Explicit arrow order only; facts and ambiguous matches stay with the model. */
export function matchNotePreferences(
  notes: string,
  options: readonly string[]
): NotePreferenceMatch[] {
  const matches: NotePreferenceMatch[] = []
  for (const note of notes.split("\n")) {
    if (!note.trimStart().startsWith("- ")) continue
    const order = /\b(?:fallback|preference) order\s*:?\s*(.+)/i.exec(note)?.[1]
    if (!order) continue
    const preferences = order
      .replace(/\.$/, "")
      .split(/\s*(?:->|→|>)\s*/)
      .map((value) => value.trim())
    if (preferences.length < 2 || preferences.some((value) => value === ""))
      continue
    for (const preference of preferences) {
      const wanted = normalizeText(preference)
      if (!wanted) break
      const exact = options.find((option) => normalizeText(option) === wanted)
      const candidates = exact
        ? [exact]
        : options.filter((option) =>
            ` ${normalizeText(option)} `.includes(` ${wanted} `)
          )
      if (candidates.length === 0) continue
      const option = candidates[0]
      if (candidates.length === 1 && option) {
        matches.push({ note, preference, option })
      }
      // An ambiguous earlier choice must not fall through to a later one.
      break
    }
  }
  return matches
}
