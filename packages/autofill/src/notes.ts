import { z } from "zod"

import type { FieldDescriptor, Question } from "./fields"
import type { ProfileSection } from "./keys"

/** Notes stop at 10,000 characters; the editor warns from 9,000 (spec 8.1). */
export const NOTES_LIMIT = 10_000
export const NOTES_WARN = 9_000
/** Snapshots kept per user (spec 8.3). */
export const NOTE_VERSIONS_KEPT = 20

const FactText = z.string().trim().min(1).max(500)

/** One line operation of a Notes merge. Line numbers name the text the model saw. */
export const NoteOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    heading: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/[^#\s]/, "A heading needs a word"),
    text: FactText,
  }),
  z.object({
    op: z.literal("replace"),
    line: z.number().int().min(1),
    text: FactText,
  }),
  z.object({ op: z.literal("delete"), line: z.number().int().min(1) }),
])
export type NoteOp = z.infer<typeof NoteOpSchema>

/** Profile fields a merge can point to when the user's text belongs there. */
export const ProfileFieldKeySchema = z.enum([
  "personal.preferred",
  "personal.pronouns",
  "contact.phone",
  "contact.address",
  "links",
  "workAuth.authorized",
  "workAuth.sponsorship",
  "workAuth.status",
  "preferences.salary",
  "preferences.start",
  "preferences.relocation",
  "preferences.workModes",
  "preferences.cities",
  "eeo",
  "other.adult",
  "other.backgroundCheck",
  "other.driversLicense",
  "other.languages",
])
export type ProfileFieldKey = z.infer<typeof ProfileFieldKeySchema>

/** The name the panel shows for a Profile field, and the page section that holds it. */
export const PROFILE_FIELDS: Record<
  ProfileFieldKey,
  { label: string; anchor: ProfileSection }
> = {
  "personal.preferred": { label: "Preferred first name", anchor: "personal" },
  "personal.pronouns": { label: "Pronouns", anchor: "personal" },
  "contact.phone": { label: "Phone", anchor: "contact" },
  "contact.address": { label: "Address", anchor: "contact" },
  links: { label: "Links", anchor: "links" },
  "workAuth.authorized": {
    label: "Authorized to work in the US",
    anchor: "work-authorization",
  },
  "workAuth.sponsorship": {
    label: "Visa sponsorship",
    anchor: "work-authorization",
  },
  "workAuth.status": {
    label: "Work authorization status",
    anchor: "work-authorization",
  },
  "preferences.salary": { label: "Salary", anchor: "preferences" },
  "preferences.start": { label: "Start date", anchor: "preferences" },
  "preferences.relocation": {
    label: "Open to relocation",
    anchor: "preferences",
  },
  "preferences.workModes": { label: "Work mode", anchor: "preferences" },
  "preferences.cities": { label: "Preferred cities", anchor: "preferences" },
  eeo: { label: "EEO answers", anchor: "eeo" },
  "other.adult": { label: "18 or older", anchor: "other" },
  "other.backgroundCheck": { label: "Background check", anchor: "other" },
  "other.driversLicense": { label: "Driver's license", anchor: "other" },
  "other.languages": { label: "Languages", anchor: "other" },
}

export const NoteMergeProposalSchema = z.object({
  ops: z.array(NoteOpSchema).max(50),
  hints: z.array(ProfileFieldKeySchema).max(10),
})
export type NoteMergeProposal = z.infer<typeof NoteMergeProposalSchema>

/** Empty Notes have no lines, not one empty line. */
function linesOf(content: string): string[] {
  return content === "" ? [] : content.split("\n")
}

/** Notes as the model sees them: `1| ## Work style`. */
export function numberLines(content: string): string {
  return linesOf(content)
    .map((line, i) => `${i + 1}| ${line}`)
    .join("\n")
}

export type ApplyResult =
  | {
      ok: true
      content: string
      added: number
      changed: number
      deleted: number
    }
  | { ok: false; reason: "line" | "duplicate" }

const isFact = (line: string | undefined): boolean =>
  line?.startsWith("- ") === true
const isHeading = (line: string): boolean => /^#+\s/.test(line)

/** Model text on one line, so a fact never turns into a heading or two facts. */
const oneLine = (text: string): string =>
  text.replace(/\s*[\r\n]+\s*/g, " ").trim()

function factLine(text: string): string {
  const line = oneLine(text)
  return line.startsWith("- ") ? line : `- ${line}`
}

/** A heading's words, without its marks: "## Work  style" gives "Work style". */
const headingText = (heading: string): string =>
  oneLine(heading).replace(/^#+/, "").replace(/\s+/g, " ").trim()

/** The line an added fact goes after: the heading's last fact, else the heading. */
function insertAfter(lines: string[], heading: string): number | null {
  const wanted = heading.toLowerCase()
  const start = lines.findIndex(
    (line) => isHeading(line) && headingText(line).toLowerCase() === wanted
  )
  if (start === -1) return null
  let at = start
  for (const [offset, line] of lines.slice(start + 1).entries()) {
    if (isHeading(line)) break
    if (isFact(line)) at = start + 1 + offset
  }
  return at
}

/**
 * Applies a merge's line operations. Line numbers name the original text;
 * only fact lines (`- `) can be replaced or deleted, each at most once. Lines
 * no operation names stay byte-identical.
 */
export function applyNoteOps(content: string, ops: NoteOp[]): ApplyResult {
  const lines = linesOf(content)
  const named = new Set<number>()
  const replaced = new Map<number, string>()
  const deleted = new Set<number>()
  for (const op of ops) {
    if (op.op === "add") continue
    if (named.has(op.line)) return { ok: false, reason: "duplicate" }
    named.add(op.line)
    const index = op.line - 1
    const line = lines[index]
    if (line === undefined || !isFact(line))
      return { ok: false, reason: "line" }
    if (op.op === "delete") deleted.add(index)
    else if (factLine(op.text) !== line) replaced.set(index, factLine(op.text))
  }

  // The facts the result keeps, so an add never repeats one.
  const facts = new Set(
    lines.flatMap((line, i) => {
      const kept = replaced.get(i) ?? line
      return deleted.has(i) || !isFact(kept) ? [] : [kept.trim()]
    })
  )
  const after = new Map<number, string[]>()
  const created = new Map<string, { heading: string; facts: string[] }>()
  let added = 0
  for (const op of ops) {
    if (op.op !== "add") continue
    const fact = factLine(op.text)
    if (facts.has(fact)) continue
    facts.add(fact)
    added++
    const heading = headingText(op.heading)
    const at = insertAfter(lines, heading)
    if (at !== null) {
      after.set(at, [...(after.get(at) ?? []), fact])
      continue
    }
    const key = heading.toLowerCase()
    const section = created.get(key) ?? { heading, facts: [] }
    section.facts.push(fact)
    created.set(key, section)
  }

  const out: string[] = []
  lines.forEach((line, i) => {
    if (!deleted.has(i)) out.push(replaced.get(i) ?? line)
    out.push(...(after.get(i) ?? []))
  })
  for (const section of created.values()) {
    if (out.length > 0 && out.at(-1)?.trim() !== "") out.push("")
    out.push(`## ${section.heading}`, ...section.facts)
  }
  return {
    ok: true,
    content: out.join("\n"),
    added,
    changed: replaced.size,
    deleted: deleted.size,
  }
}

export const DiffLineSchema = z.object({
  kind: z.enum(["same", "add", "remove"]),
  text: z.string(),
})
export type DiffLine = z.infer<typeof DiffLineSchema>

/**
 * Line pairs the longest common subsequence may compare. Past it the changed
 * middle shows as removed, then added: still exact, only less compact.
 */
const DIFF_CELLS = 4_000_000

/** The changed middle of a diff, removals before additions where they tie. */
function middle(a: string[], b: string[]): DiffLine[] {
  if (a.length * b.length > DIFF_CELLS) {
    return [
      ...a.map((text): DiffLine => ({ kind: "remove", text })),
      ...b.map((text): DiffLine => ({ kind: "add", text })),
    ]
  }
  // common[i * width + j]: the longest common subsequence of a[i:] and b[j:].
  const width = b.length + 1
  const common = new Uint16Array((a.length + 1) * width)
  const at = (i: number, j: number): number => common[i * width + j] ?? 0
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i * width + j] =
        a[i] === b[j]
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  const diff: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    const left = a[i]
    const right = b[j]
    if (left !== undefined && left === right) {
      diff.push({ kind: "same", text: left })
      i++
      j++
    } else if (
      left !== undefined &&
      (right === undefined || at(i + 1, j) >= at(i, j + 1))
    ) {
      diff.push({ kind: "remove", text: left })
      i++
    } else if (right !== undefined) {
      diff.push({ kind: "add", text: right })
      j++
    } else break
  }
  return diff
}

/** A line diff for Review, over the longest common subsequence of lines. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = linesOf(before)
  const b = linesOf(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++
  }
  const same = (text: string): DiffLine => ({ kind: "same", text })
  return [
    ...a.slice(0, head).map(same),
    ...middle(a.slice(head, a.length - tail), b.slice(head, b.length - tail)),
    ...a.slice(a.length - tail).map(same),
  ]
}

const squash = (text: string): string => text.replace(/\s+/g, " ").trim()

/**
 * The page's own questions, one per field in page order, for when AI cannot
 * consolidate them (spec 6.5).
 */
export function plainQuestions(
  fields: FieldDescriptor[],
  fieldIds: string[]
): Question[] {
  const wanted = new Set(fieldIds)
  return fields
    .filter(({ id }) => wanted.has(id))
    .map((field, i) => {
      const options = (field.options ?? []).map(({ label }) => label)
      return {
        id: `p${i + 1}`,
        text:
          squash(field.label) ||
          squash(field.help ?? "").slice(0, 500) ||
          "Unlabeled question",
        original: [{ fieldId: field.id, label: field.label }],
        ...(options.length > 0 ? { options } : {}),
        companySpecific: false,
      }
    })
}
