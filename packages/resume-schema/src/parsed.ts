import { z } from "zod"

import { newId } from "./ids"
import {
  SECTION_ITEM_KIND,
  SectionType,
  type Basics,
  type Bullet,
  type Item,
  type Resume,
  type Section,
  type SectionTypeName,
} from "./schema"

/**
 * The import contract: what a model may return when reading a resume, and the
 * pure assembly that turns it into a `Resume`.
 *
 * The model never emits node ids, and never emits a `YYYY-MM` date. It copies
 * what the document says; `assembleResume` mints the ids, normalises the dates,
 * drops anything that cannot be made valid, and is the only thing that decides
 * document shape. So a bad model answer produces a smaller resume, never an
 * invalid one.
 */

/** Looser than the document's own caps: assembly trims rather than rejects. */
const RawShort = z.string().max(400)
const RawText = z.string().max(4000)
const RawDate = z.string().max(60)

/**
 * One flat item shape rather than a discriminated union. Structured output on
 * a flash model is reliable for a plain object and brittle for `anyOf`, and
 * there is nothing a discriminator would buy: the section's `type` already
 * says which fields matter, so assembly reads those and ignores the rest.
 */
export const ParsedItemSchema = z.object({
  company: RawShort.optional(),
  role: RawShort.optional(),
  school: RawShort.optional(),
  degree: RawShort.optional(),
  field: RawShort.optional(),
  name: RawShort.optional(),
  title: RawShort.optional(),
  subtitle: RawShort.optional(),
  url: RawShort.optional(),
  location: RawShort.optional(),
  start: RawDate.optional(),
  end: RawDate.optional(),
  bullets: z.array(RawText).max(40).optional(),
  skills: z.array(RawShort).max(80).optional(),
})

export const ParsedSectionSchema = z.object({
  type: SectionType,
  title: RawShort,
  items: z.array(ParsedItemSchema).max(60),
})

export const ParsedBasicsSchema = z.object({
  name: RawShort.optional(),
  headline: RawShort.optional(),
  email: RawShort.optional(),
  phone: RawShort.optional(),
  location: RawShort.optional(),
  summary: RawText.optional(),
  links: z
    .array(z.object({ label: RawShort, url: RawShort }))
    .max(20)
    .optional(),
})

export const ParsedResumeSchema = z.object({
  basics: ParsedBasicsSchema,
  sections: z.array(ParsedSectionSchema).max(30),
})

export type ParsedItem = z.infer<typeof ParsedItemSchema>
export type ParsedSection = z.infer<typeof ParsedSectionSchema>
export type ParsedResume = z.infer<typeof ParsedResumeSchema>

/** Stands in when the document has no readable name; `basics.name` is required. */
export const IMPORT_FALLBACK_NAME = "Your Name"

const DEFAULT_SECTION_TITLE: Record<SectionTypeName, string> = {
  experience: "Experience",
  education: "Education",
  projects: "Projects",
  skills: "Skills",
  custom: "Other",
}

/* ------------------------------------------------------------------ dates */

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

const PRESENT = /^(present|current|now|ongoing|to date|today)$/

function yearMonth(year: number, month: number): string | null {
  if (year < 1900 || year > 2999) return null
  const safe = month >= 1 && month <= 12 ? month : 1
  return `${year}-${String(safe).padStart(2, "0")}`
}

/**
 * Raw date text to `YYYY-MM`, or null when there is not even a year to work
 * with. A year on its own becomes January: the document said 2019 and the
 * schema needs a month, and the editor shows the guess for the user to correct.
 */
export function parseYearMonth(raw: string | undefined): string | null {
  const text = (raw ?? "").trim().toLowerCase()
  if (!text) return null

  const iso = /(\d{4})[-/.](\d{1,2})(?!\d)/.exec(text)
  if (iso) return yearMonth(Number(iso[1]), Number(iso[2]))

  const slash = /(?<!\d)(\d{1,2})[-/.](\d{4})/.exec(text)
  if (slash) return yearMonth(Number(slash[2]), Number(slash[1]))

  const year = /(?<!\d)(\d{4})(?!\d)/.exec(text)
  if (!year) return null

  const word = /[a-z]+/.exec(text)
  const month = word ? MONTHS[word[0]] : undefined
  return yearMonth(Number(year[1]), month ?? 1)
}

/** Same, plus the words that mean "still there". */
export function parseEndDate(raw: string | undefined): string | null {
  const text = (raw ?? "").trim().toLowerCase()
  if (PRESENT.test(text)) return "present"
  return parseYearMonth(raw)
}

/* ------------------------------------------------------------------ text */

function short(value: string | undefined, max = 200): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
}

function long(value: string | undefined, max = 2000): string {
  return (value ?? "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max)
}

/** Leading list markers survive extraction; they are noise, not content. */
const LEADING_MARKER = /^[\s•‣⁃▪●◦·*+–—-]+/

function bullets(raw: string[] | undefined, max: number): Bullet[] {
  return (raw ?? [])
    .map((line) => long(line.replace(LEADING_MARKER, "")))
    .filter((line) => line.length > 0)
    .slice(0, max)
    .map((line) => ({ id: newId("bul"), text: line }))
}

function validUrl(value: string | undefined): string | undefined {
  const candidate = short(value, 500)
  if (!candidate) return undefined
  const withScheme = /^https?:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`
  return z.url().max(500).safeParse(withScheme).success ? withScheme : undefined
}

/* ------------------------------------------------------------------ items */

function experienceItem(parsed: ParsedItem): Item | null {
  const company = short(parsed.company ?? parsed.subtitle)
  const role = short(parsed.role ?? parsed.title)
  if (!company || !role) return null

  const start = parseYearMonth(parsed.start)
  if (!start) return null
  // A blank end date on a job is how resumes write "still there".
  const end = parsed.end?.trim() ? parseEndDate(parsed.end) : "present"
  if (!end) return null

  return {
    id: newId("exp"),
    kind: "experience",
    company,
    role,
    location: short(parsed.location) || undefined,
    start,
    end,
    bullets: bullets(parsed.bullets, 20),
  }
}

function educationItem(parsed: ParsedItem): Item | null {
  const school = short(parsed.school ?? parsed.company ?? parsed.title)
  if (!school) return null
  return {
    id: newId("edu"),
    kind: "education",
    school,
    degree: short(parsed.degree ?? parsed.role) || undefined,
    field: short(parsed.field) || undefined,
    start: parseYearMonth(parsed.start) ?? undefined,
    end: parseEndDate(parsed.end) ?? undefined,
    bullets: bullets(parsed.bullets, 10),
  }
}

function projectItem(parsed: ParsedItem): Item | null {
  const name = short(parsed.name ?? parsed.title ?? parsed.role)
  if (!name) return null
  return {
    id: newId("prj"),
    kind: "project",
    name,
    url: validUrl(parsed.url),
    start: parseYearMonth(parsed.start) ?? undefined,
    end: parseEndDate(parsed.end) ?? undefined,
    bullets: bullets(parsed.bullets, 20),
  }
}

function skillsItem(parsed: ParsedItem, fallbackLabel: string): Item | null {
  const skills = (parsed.skills ?? [])
    .map((entry) => short(entry))
    .filter((entry) => entry.length > 0)
    .slice(0, 50)
  if (skills.length === 0) return null
  return {
    id: newId("skl"),
    kind: "skills",
    label: short(parsed.title ?? parsed.name ?? parsed.role) || fallbackLabel,
    skills,
  }
}

function customItem(parsed: ParsedItem): Item | null {
  const title = short(
    parsed.title ??
      parsed.role ??
      parsed.name ??
      parsed.company ??
      parsed.school
  )
  if (!title) return null
  return {
    id: newId("cus"),
    kind: "custom",
    title,
    subtitle: short(parsed.subtitle ?? parsed.company) || undefined,
    start: parseYearMonth(parsed.start) ?? undefined,
    end: parseEndDate(parsed.end) ?? undefined,
    bullets: bullets(parsed.bullets, 20),
  }
}

/**
 * Where an experience item goes when its dates cannot be read. A custom item
 * has optional dates, so the wording survives with the raw date text kept in
 * the subtitle rather than being thrown away or invented into a month.
 */
function demotedItem(parsed: ParsedItem): Item | null {
  const title = short(parsed.role ?? parsed.title ?? parsed.company)
  if (!title) return null
  const range = [parsed.start, parsed.end]
    .map((part) => short(part, 60))
    .filter((part) => part.length > 0)
    .join(" to ")
  const subtitle = [short(parsed.company), range]
    .filter((part) => part.length > 0)
    .join(" · ")
  return {
    id: newId("cus"),
    kind: "custom",
    title,
    subtitle: short(subtitle) || undefined,
    bullets: bullets(parsed.bullets, 20),
  }
}

function buildItem(
  parsed: ParsedItem,
  kind: Item["kind"],
  fallbackLabel: string
): Item | null {
  switch (kind) {
    case "experience":
      return experienceItem(parsed)
    case "education":
      return educationItem(parsed)
    case "project":
      return projectItem(parsed)
    case "skills":
      return skillsItem(parsed, fallbackLabel)
    case "custom":
      return customItem(parsed)
  }
}

/* --------------------------------------------------------------- assembly */

function assembleBasics(parsed: ParsedResume["basics"]): Basics {
  const email = short(parsed.email, 200)
  const links = (parsed.links ?? [])
    .map((link) => ({
      id: newId("lnk"),
      label: short(link.label),
      url: validUrl(link.url),
    }))
    .filter(
      (link): link is { id: string; label: string; url: string } =>
        link.label.length > 0 && link.url !== undefined
    )
    .slice(0, 10)

  return {
    id: "basics",
    name: short(parsed.name) || IMPORT_FALLBACK_NAME,
    headline: short(parsed.headline) || undefined,
    email: z.email().safeParse(email).success ? email : undefined,
    phone: short(parsed.phone) || undefined,
    location: short(parsed.location) || undefined,
    links,
    summary: long(parsed.summary) || undefined,
  }
}

function assembleSection(parsed: ParsedSection): Section[] {
  const kind = SECTION_ITEM_KIND[parsed.type]
  const title = short(parsed.title) || DEFAULT_SECTION_TITLE[parsed.type]

  const items: Item[] = []
  const demoted: Item[] = []
  for (const raw of parsed.items) {
    const built = buildItem(raw, kind, title)
    if (built) {
      items.push(built)
      continue
    }
    // Only experience can fail on dates alone; everything else is optional.
    if (kind !== "experience") continue
    const fallback = demotedItem(raw)
    if (fallback) demoted.push(fallback)
  }

  const sections: Section[] = []
  if (items.length > 0) {
    sections.push({
      id: newId("sec"),
      type: parsed.type,
      title,
      items: items.slice(0, 50),
    })
  }
  if (demoted.length > 0) {
    sections.push({
      id: newId("sec"),
      type: "custom",
      title,
      items: demoted.slice(0, 50),
    })
  }
  return sections
}

/**
 * Pure. Everything the model got wrong shows up here as content that is
 * dropped or demoted, never as a document the editor refuses to save.
 */
export function assembleResume(parsed: ParsedResume): Resume {
  return {
    schemaVersion: 1,
    basics: assembleBasics(parsed.basics),
    sections: parsed.sections.flatMap(assembleSection).slice(0, 20),
  }
}

/** The resume list needs a name; the document's own is the best one there is. */
export function importTitle(resume: Resume): string | undefined {
  const name = resume.basics.name
  return name && name !== IMPORT_FALLBACK_NAME ? `${name} resume` : undefined
}
