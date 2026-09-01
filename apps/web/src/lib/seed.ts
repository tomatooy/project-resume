import type { Resume } from "@workspace/resume-schema"
import type { TemplateId } from "@workspace/resume-render"

/**
 * Demo content, taken from the Claude Design mock so the console opens on the
 * screen the design shows. Replaced by the user's own resumes as soon as the
 * Supabase-backed server functions land.
 */

const id = (prefix: string, key: string) =>
  `${prefix}_${key
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .padEnd(10, "0")
    .slice(0, 10)}`

const SUMMARY =
  "Senior product designer with 9 years shipping systems-heavy B2B products. Led an onboarding redesign that lifted activation 34% and scaled a design system adopted by 6 teams."

function bullets(prefix: string, texts: string[]) {
  return texts.map((text, i) => ({ id: id("bul", `${prefix}${i}`), text }))
}

export const mayaResume: Resume = {
  schemaVersion: 1,
  basics: {
    id: "basics",
    name: "Maya Chandrasekaran",
    headline: "Senior Product Designer",
    email: "maya@chandra.design",
    phone: "+351 912 448 201",
    location: "Lisbon",
    links: [
      {
        id: id("lnk", "li"),
        label: "linkedin.com/in/mayachandra",
        url: "https://linkedin.com/in/mayachandra",
      },
      {
        id: id("lnk", "site"),
        label: "chandra.design",
        url: "https://chandra.design",
      },
    ],
    summary: SUMMARY,
  },
  sections: [
    {
      id: id("sec", "exp"),
      type: "experience",
      title: "Experience",
      items: [
        {
          id: id("exp", "northwind"),
          kind: "experience",
          company: "Northwind Labs",
          role: "Senior Product Designer",
          location: "Remote",
          start: "2022-01",
          end: "present",
          bullets: bullets("nw", [
            "Led the redesign of the onboarding flow, working with engineering and research to ship in six weeks.",
            "Grew the design system from 40 to 180 components, adopted by 6 product teams.",
            "Ran a research program with 40+ interviews that reshaped the 2025 roadmap.",
          ]),
        },
        {
          id: id("exp", "cartograph"),
          kind: "experience",
          company: "Cartograph",
          role: "Product Designer",
          location: "Lisbon",
          start: "2019-03",
          end: "2021-12",
          bullets: bullets("cg", [
            "Owned end-to-end design for the analytics suite used by 12k weekly users.",
            "Introduced a weekly critique ritual that shortened design review cycles.",
          ]),
        },
        {
          id: id("exp", "perigee"),
          kind: "experience",
          company: "Perigee Studio",
          role: "UX Designer",
          location: "Porto",
          start: "2017-06",
          end: "2019-02",
          bullets: bullets("ps", [
            "Delivered 20+ client projects across fintech and civic tech.",
          ]),
        },
      ],
    },
    {
      id: id("sec", "prj"),
      type: "projects",
      title: "Projects",
      items: [
        {
          id: id("prj", "tokens"),
          kind: "project",
          name: "Tokenwright",
          url: "https://github.com/mayachandra/tokenwright",
          start: "2023-02",
          bullets: bullets("tw", [
            "Open-source bridge from Figma variables to CSS custom properties, used by 3 teams outside Northwind.",
          ]),
        },
      ],
    },
    {
      id: id("sec", "edu"),
      type: "education",
      title: "Education",
      items: [
        {
          id: id("edu", "porto"),
          kind: "education",
          school: "University of Porto",
          degree: "BA",
          field: "Communication Design",
          start: "2013-09",
          end: "2017-06",
          bullets: [],
        },
      ],
    },
    {
      id: id("sec", "skl"),
      type: "skills",
      title: "Skills",
      items: [
        {
          id: id("skl", "craft"),
          kind: "skills",
          label: "Craft",
          skills: [
            "Design systems",
            "Prototyping",
            "Research ops",
            "Figma",
            "Accessibility (WCAG 2.2)",
            "Front-end handoff",
          ],
        },
      ],
    },
  ],
}

export type SeedResume = {
  id: string
  title: string
  subtitle: string
  templateId: TemplateId
  updatedMinutesAgo: number
  data: Resume
}

/** Variants of the same person, matching the four cards in the design's rail. */
export const seedResumes: SeedResume[] = [
  {
    id: "r_figma",
    title: "Product Design at Figma",
    subtitle: "Tailored · Senior Product Designer",
    templateId: "lisbon",
    updatedMinutesAgo: 120,
    data: mayaResume,
  },
  {
    id: "r_linear",
    title: "Design at Linear",
    subtitle: "Tailored · Product Designer",
    templateId: "meridian",
    updatedMinutesAgo: 60 * 26,
    data: {
      ...mayaResume,
      basics: { ...mayaResume.basics, headline: "Product Designer" },
    },
  },
  {
    id: "r_general",
    title: "General 2026",
    subtitle: "Master copy",
    templateId: "plainsong",
    updatedMinutesAgo: 60 * 24 * 6,
    data: mayaResume,
  },
  {
    id: "r_systems",
    title: "Design Systems Lead",
    subtitle: "Draft · not tailored",
    templateId: "ledger",
    updatedMinutesAgo: 60 * 24 * 21,
    data: {
      ...mayaResume,
      basics: { ...mayaResume.basics, headline: "Design Systems Lead" },
    },
  },
]
