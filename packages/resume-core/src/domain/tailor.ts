import type { Item, Resume, Section } from "@workspace/resume-schema"

/**
 * The two rules the prompt is not trusted with.
 *
 * Every job in the source survives. The model may cut an unrelated role down
 * to one line, and should, but removing it would leave a gap in the person's
 * employment history. That reads as a fact about the candidate rather than an
 * editing decision, and nobody asked for it.
 *
 * A section with no items left is removed, because the templates render it as
 * a heading with nothing underneath.
 *
 * Ordering inside a section is the model's to decide, so restored items go on
 * the end rather than back where they were.
 */
export function enforceTailorRules(source: Resume, tailored: Resume): Resume {
  const sections = tailored.sections.map((section) =>
    section.type === "experience" ? restoreExperience(source, section) : section
  )

  // A whole section the model dropped: only experience is protected, and only
  // when the source actually had one.
  for (const section of source.sections) {
    if (section.type !== "experience") continue
    if (sections.some((kept) => kept.type === "experience")) continue
    sections.push(section)
  }

  return { ...tailored, sections: sections.filter((s) => s.items.length > 0) }
}

function restoreExperience(source: Resume, section: Section): Section {
  const missing = source.sections
    .filter((s) => s.type === "experience")
    .flatMap((s) => s.items)
    .filter((item) => !section.items.some((kept) => sameJob(kept, item)))

  return missing.length === 0
    ? section
    : { ...section, items: [...section.items, ...missing] }
}

/**
 * Ids cannot be used: the tailored document's ids are minted fresh by
 * `assembleResume` and match nothing. Company, role and start are what the
 * model is forbidden to change, which is exactly what makes them the key.
 */
function sameJob(a: Item, b: Item): boolean {
  if (a.kind !== "experience" || b.kind !== "experience") return false
  return (
    norm(a.company) === norm(b.company) &&
    norm(a.role) === norm(b.role) &&
    norm(a.start) === norm(b.start)
  )
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase()
}
