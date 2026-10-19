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
  job: AiJob | null
  page: { company: string | null; title: string | null }
  today: Date
}

/** Characters of the job description that reach AI. */
export const JOB_DESCRIPTION_MAX = 8_000

/** The Profile without EEO and salary, which only rules use (spec 12.3). */
function profileJson(profile: Profile): JsonObject {
  const { startKind, startDate, noticeWeeks, relocation, workModes, cities } =
    profile.preferences
  return {
    personal: profile.personal,
    contact: profile.contact,
    links: profile.links,
    workAuth: profile.workAuth,
    preferences: {
      startKind,
      startDate,
      noticeWeeks,
      relocation,
      workModes,
      cities,
    },
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

function resumeJson({ basics, sections }: Resume): JsonObject {
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
    sections: sections.map((section) => ({
      title: section.title,
      type: section.type,
      items: section.items.map(itemJson),
    })),
  }
}

/**
 * What every AI pass knows about the applicant: the Profile (without EEO and
 * salary), the resume, the whole Notes text, the job and the page.
 */
export function applicantContext(input: ContextInput): Json {
  const { job } = input
  return {
    today: isoDate(input.today),
    profile: profileJson(input.profile),
    resume: input.resume && resumeJson(input.resume),
    notes: input.notes,
    job: job && {
      company: job.company,
      title: job.title,
      requirements: {
        mustHaves: job.requirements.mustHaves,
        niceToHaves: job.requirements.niceToHaves,
        keywords: job.requirements.keywords,
      },
      description: job.description.slice(0, JOB_DESCRIPTION_MAX),
    },
    page: { company: input.page.company, title: input.page.title },
  }
}
