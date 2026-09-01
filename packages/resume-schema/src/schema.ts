import { z } from "zod"

/**
 * Node id prefixes. `basics` is the one node with a fixed, unprefixed id so
 * that patches can always address it without looking it up.
 */
export const NODE_ID_PREFIXES = [
  "sec",
  "exp",
  "edu",
  "prj",
  "skl",
  "cus",
  "bul",
  "lnk",
] as const
export type NodeIdPrefix = (typeof NODE_ID_PREFIXES)[number]

export const NodeId = z
  .string()
  .regex(
    /^(?:basics|sec|exp|edu|prj|skl|cus|bul|lnk)_[A-Za-z0-9_-]{10}$|^basics$/,
    "Not a valid node id"
  )

export const YearMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the YYYY-MM format")
export const EndDate = z.union([YearMonth, z.literal("present")])

const Text = z.string().max(2000)
const Short = z.string().max(200)

export const LinkSchema = z.object({
  id: NodeId,
  label: Short,
  url: z.url().max(500),
})

export const BulletSchema = z.object({ id: NodeId, text: Text })

export const BasicsSchema = z.object({
  id: z.literal("basics"),
  name: Short.min(1),
  headline: Short.optional(),
  email: z.email().optional(),
  phone: Short.optional(),
  location: Short.optional(),
  links: z.array(LinkSchema).max(10),
  summary: Text.optional(),
})

export const ExperienceItemSchema = z.object({
  id: NodeId,
  kind: z.literal("experience"),
  company: Short.min(1),
  role: Short.min(1),
  location: Short.optional(),
  start: YearMonth,
  end: EndDate,
  bullets: z.array(BulletSchema).max(20),
})

export const EducationItemSchema = z.object({
  id: NodeId,
  kind: z.literal("education"),
  school: Short.min(1),
  degree: Short.optional(),
  field: Short.optional(),
  start: YearMonth.optional(),
  end: EndDate.optional(),
  bullets: z.array(BulletSchema).max(10),
})

export const ProjectItemSchema = z.object({
  id: NodeId,
  kind: z.literal("project"),
  name: Short.min(1),
  url: z.url().optional(),
  start: YearMonth.optional(),
  end: EndDate.optional(),
  bullets: z.array(BulletSchema).max(20),
})

export const SkillsGroupSchema = z.object({
  id: NodeId,
  kind: z.literal("skills"),
  label: Short.min(1),
  skills: z.array(Short.min(1)).max(50),
})

export const CustomItemSchema = z.object({
  id: NodeId,
  kind: z.literal("custom"),
  title: Short.min(1),
  subtitle: Short.optional(),
  start: YearMonth.optional(),
  end: EndDate.optional(),
  bullets: z.array(BulletSchema).max(20),
})

export const ItemSchema = z.discriminatedUnion("kind", [
  ExperienceItemSchema,
  EducationItemSchema,
  ProjectItemSchema,
  SkillsGroupSchema,
  CustomItemSchema,
])

export const SectionType = z.enum([
  "experience",
  "education",
  "projects",
  "skills",
  "custom",
])

/** The item `kind` each section type is allowed to hold. */
export const SECTION_ITEM_KIND = {
  experience: "experience",
  education: "education",
  projects: "project",
  skills: "skills",
  custom: "custom",
} as const satisfies Record<
  z.infer<typeof SectionType>,
  z.infer<typeof ItemSchema>["kind"]
>

export const SectionSchema = z
  .object({
    id: NodeId,
    type: SectionType,
    title: Short.min(1),
    items: z.array(ItemSchema).max(50),
  })
  .superRefine((section, ctx) => {
    const expected = SECTION_ITEM_KIND[section.type]
    section.items.forEach((item, index) => {
      if (item.kind !== expected) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "kind"],
          message: `A ${section.type} section holds ${expected} items, got ${item.kind}`,
          input: item,
        })
      }
    })
  })

export const ResumeSchema = z
  .object({
    schemaVersion: z.literal(1),
    basics: BasicsSchema,
    sections: z.array(SectionSchema).max(20),
  })
  .superRefine((resume, ctx) => {
    const seen = new Set<string>(["basics"])
    const flag = (id: string, path: (string | number)[]) => {
      if (seen.has(id)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `Duplicate node id "${id}"`,
          input: id,
        })
        return
      }
      seen.add(id)
    }

    resume.basics.links.forEach((link, l) => {
      flag(link.id, ["basics", "links", l, "id"])
    })

    resume.sections.forEach((section, s) => {
      flag(section.id, ["sections", s, "id"])
      section.items.forEach((item, i) => {
        flag(item.id, ["sections", s, "items", i, "id"])
        if ("bullets" in item) {
          item.bullets.forEach((bullet, b) => {
            flag(bullet.id, ["sections", s, "items", i, "bullets", b, "id"])
          })
        }
      })
    })
  })

export type Link = z.infer<typeof LinkSchema>
export type Bullet = z.infer<typeof BulletSchema>
export type Basics = z.infer<typeof BasicsSchema>
export type ExperienceItem = z.infer<typeof ExperienceItemSchema>
export type EducationItem = z.infer<typeof EducationItemSchema>
export type ProjectItem = z.infer<typeof ProjectItemSchema>
export type SkillsGroup = z.infer<typeof SkillsGroupSchema>
export type CustomItem = z.infer<typeof CustomItemSchema>
export type Item = z.infer<typeof ItemSchema>
export type Section = z.infer<typeof SectionSchema>
export type SectionTypeName = z.infer<typeof SectionType>
export type Resume = z.infer<typeof ResumeSchema>

/** Items that carry a `bullets` array. Skills groups do not. */
export type BulletedItem = Exclude<Item, SkillsGroup>

export function hasBullets(item: Item): item is BulletedItem {
  return item.kind !== "skills"
}

export const CURRENT_SCHEMA_VERSION = 1
