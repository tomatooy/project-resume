import { customAlphabet } from "nanoid"
import type { NodeIdPrefix, Resume } from "./schema"

/**
 * URL-safe alphabet without look-alike separators beyond `_` and `-`, which the
 * `NodeId` regex already allows. Ten characters gives ~59 bits, far more than a
 * single resume needs.
 */
const nano = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-",
  10
)

export function newId(prefix: NodeIdPrefix): string {
  return `${prefix}_${nano()}`
}

/**
 * Deep copy with every node id regenerated. Used when duplicating a resume so
 * the copy shares no ids with the original.
 */
export function regenerateIds(resume: Resume): Resume {
  return {
    schemaVersion: resume.schemaVersion,
    basics: {
      ...resume.basics,
      id: "basics",
      links: resume.basics.links.map((link) => ({ ...link, id: newId("lnk") })),
    },
    sections: resume.sections.map((section) => ({
      ...section,
      id: newId("sec"),
      items: section.items.map((item) => {
        if (item.kind === "skills") {
          return { ...item, id: newId("skl"), skills: [...item.skills] }
        }
        const prefix = ITEM_PREFIX[item.kind]
        return {
          ...item,
          id: newId(prefix),
          bullets: item.bullets.map((bullet) => ({
            ...bullet,
            id: newId("bul"),
          })),
        }
      }),
    })),
  }
}

export const ITEM_PREFIX = {
  experience: "exp",
  education: "edu",
  project: "prj",
  skills: "skl",
  custom: "cus",
} as const satisfies Record<string, NodeIdPrefix>
