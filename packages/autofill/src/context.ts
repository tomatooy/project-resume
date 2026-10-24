import type { Bullet, Item, Resume } from "@workspace/resume-schema"

import { isoDate } from "./format"
import type { Profile } from "./profile"

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json }
type JsonObject = { [key: string]: Json }

/** The job a tailored resume was made for, as AI sees it. */
export type AiJob = {
  company: string
  title: string
  requirements: {
    mustHaves: string[]
    niceToHaves: string[]
    keywords: string[]
  }
  description: string
}

export type ContextInput = {
  profile: Profile
  resume: Resume | null
  notes: string
  /** Legacy callers may pass these; neither is serialized. */
  job?: AiJob | null
  page?: { company: string | null; title: string | null }
  today: Date
}

/** Prune missing values without losing explicit negatives or zero. */
export function compactJson(value: Json): Json | undefined {
  if (value === null || (typeof value === "string" && value.trim() === ""))
    return undefined
  if (Array.isArray(value)) {
    const values = value.flatMap((item) => {
      const compact = compactJson(item)
      return compact === undefined ? [] : [compact]
    })
    return values.length ? values : undefined
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).flatMap(([key, item]) => {
      const compact = compactJson(item)
      return compact === undefined ? [] : [[key, compact]]
    })
    return entries.length ? Object.fromEntries(entries) : undefined
  }
  return value
}

/** Salary stays with rules; other Profile answers are available to AI. */
function profileJson(profile: Profile): JsonObject {
  const { startKind, startDate, noticeWeeks, relocation, workModes, cities } =
    profile.preferences
  return {
    personal: profile.personal,
    contact: profile.contact,
    links: profile.links,
    experience: profile.experience.map(itemJson),
    education: profile.education.map(itemJson),
    skills: profile.skills.map(itemJson),
    workAuth: profile.workAuth,
    preferences: {
      startKind,
      startDate,
      noticeWeeks,
      relocation,
      workModes,
      cities,
    },
    eeo: profile.eeo,
    other: profile.other,
  }
}

/** Leaves out what a resume node does not have. */
function present(entries: { [key: string]: Json | undefined }): JsonObject {
  const object: JsonObject = {}
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) object[key] = value
  }
  return object
}

const texts = (bullets: Bullet[]): string[] => bullets.map(({ text }) => text)

/** A resume item without its node id and kind, which mean nothing to a model. */
function itemJson(item: Item): JsonObject {
  switch (item.kind) {
    case "experience":
      return present({
        company: item.company,
        role: item.role,
        location: item.location,
        start: item.start,
        end: item.end,
        bullets: texts(item.bullets),
      })
    case "education":
      return present({
        school: item.school,
        degree: item.degree,
        field: item.field,
        start: item.start,
        end: item.end,
        bullets: texts(item.bullets),
      })
    case "project":
      return present({
        name: item.name,
        url: item.url,
        start: item.start,
        end: item.end,
        bullets: texts(item.bullets),
      })
    case "skills":
      return { label: item.label, skills: item.skills }
    case "custom":
      return present({
        title: item.title,
        subtitle: item.subtitle,
        start: item.start,
        end: item.end,
        bullets: texts(item.bullets),
      })
  }
}

function resumeJson(
  { basics, sections }: Resume,
  profile: Profile
): JsonObject {
  return {
    basics: present({
      name: basics.name,
      headline: basics.headline,
      email: basics.email,
      phone: basics.phone,
      location: basics.location,
      links: basics.links.map(({ label, url }) => ({ label, url })),
      summary: basics.summary,
    }),
    sections: sections
      .filter((section) => {
        switch (section.type) {
          case "experience":
            return profile.experience.length === 0
          case "education":
            return profile.education.length === 0
          case "skills":
            return profile.skills.length === 0
          default:
            return true
        }
      })
      .map((section) => ({
        title: section.title,
        type: section.type,
        items: section.items.map(itemJson),
      })),
  }
}

/**
 * Applicant records only. Imported job and page metadata never enter AI state.
 * Notes remain verbatim; structured records lose only empty values and node ids.
 */
export function applicantContext(input: ContextInput): Json {
  return {
    today: isoDate(input.today),
    profile: compactJson(profileJson(input.profile)) ?? {},
    resume: input.resume
      ? (compactJson(resumeJson(input.resume, input.profile)) ?? null)
      : null,
    notes: input.notes,
  }
}
