import type { Resume } from "../schema"
import { bullets, fid } from "./build"

/** What "New resume" creates: valid, empty enough to be obviously a template. */
export const starter: Resume = {
  schemaVersion: 1,
  basics: {
    id: "basics",
    name: "Your Name",
    headline: "Your title",
    email: "you@example.com",
    location: "City, Country",
    links: [
      {
        id: fid("lnk", "site"),
        label: "Portfolio",
        url: "https://example.com",
      },
    ],
    summary: "",
  },
  sections: [
    {
      id: fid("sec", "exp"),
      type: "experience",
      title: "Experience",
      items: [
        {
          id: fid("exp", "first"),
          kind: "experience",
          company: "Company",
          role: "Your role",
          location: "City",
          start: "2023-01",
          end: "present",
          bullets: bullets("st", [
            "What you did, and what changed because you did it.",
          ]),
        },
      ],
    },
    {
      id: fid("sec", "edu"),
      type: "education",
      title: "Education",
      items: [
        {
          id: fid("edu", "first"),
          kind: "education",
          school: "University",
          degree: "Degree",
          field: "Field of study",
          start: "2019-09",
          end: "2023-06",
          bullets: [],
        },
      ],
    },
    {
      id: fid("sec", "skl"),
      type: "skills",
      title: "Skills",
      items: [
        {
          id: fid("skl", "core"),
          kind: "skills",
          label: "Core",
          skills: ["Skill one", "Skill two"],
        },
      ],
    },
  ],
}
