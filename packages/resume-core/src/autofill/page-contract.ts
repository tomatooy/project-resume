import { z } from "zod"
import { ConceptSchema } from "./concept"

export const PAGE_VIEW_LIMITS = {
  nodes: 1000,
  bytes: 49152,
  roots: 40,
  contextReads: 3,
} as const

const ref = z.string().min(1).max(150)
export const PageNodeSchema = z.strictObject({
  ref,
  rootId: ref,
  parentRef: ref.optional(),
  tag: z.string().min(1).max(80),
  role: z.string().max(100).optional(),
  text: z.string().max(2000),
  fieldId: ref.optional(),
  relations: z
    .array(
      z.strictObject({
        kind: z.enum([
          "label",
          "description",
          "controls",
          "owns",
          "form",
          "slot",
          "nearby",
        ]),
        ref,
      })
    )
    .max(40),
})
export type PageNode = z.infer<typeof PageNodeSchema>

export const PageViewSchema = z.strictObject({
  snapshotId: ref,
  documentEpoch: z.number().int().nonnegative(),
  roots: z
    .array(
      z.strictObject({
        rootId: ref,
        kind: z.enum(["document", "shadow", "frame"]),
      })
    )
    .max(PAGE_VIEW_LIMITS.roots),
  nodes: z.array(PageNodeSchema).max(PAGE_VIEW_LIMITS.nodes),
  coverage: z.strictObject({
    complete: z.boolean(),
    truncated: z.boolean(),
    unobservedFrames: z.number().int().nonnegative(),
  }),
})
export type PageView = z.infer<typeof PageViewSchema>

export const ContextReadSchema = z.strictObject({
  fieldId: ref,
  relation: z.enum(["ancestors", "siblings", "description", "options"]),
  reason: z.string().min(1).max(300),
})
export type ContextRead = z.infer<typeof ContextReadSchema>

export const PageInterpretationSchema = z.strictObject({
  snapshotId: ref,
  regions: z
    .array(
      z.strictObject({
        regionRef: ref,
        evidenceRefs: z.array(ref).min(1).max(20),
      })
    )
    .max(40),
  fields: z
    .array(
      z.strictObject({
        fieldId: ref,
        fieldRevision: z.number().int().nonnegative(),
        regionRef: ref,
        concept: ConceptSchema,
        evidenceRefs: z.array(ref).min(1).max(20),
        groupId: ref.optional(),
        requiresDraft: z.boolean(),
      })
    )
    .max(200),
  groups: z
    .array(
      z.strictObject({
        groupId: ref,
        kind: z.enum(["experience", "education", "other"]),
        fieldIds: z.array(ref).min(1).max(200),
        evidenceRefs: z.array(ref).min(1).max(20),
      })
    )
    .max(200),
  excluded: z
    .array(
      z.strictObject({
        fieldId: ref,
        reason: z.enum([
          "navigation",
          "search",
          "authentication",
          "not_application",
          "unsupported",
        ]),
        evidenceRefs: z.array(ref).min(1).max(20),
      })
    )
    .max(200),
  needsContext: z.array(ContextReadSchema).max(200),
})
export type PageInterpretation = z.infer<typeof PageInterpretationSchema>

export const InterpretedPageSchema = PageInterpretationSchema.extend({
  unresolvedFieldIds: z.array(ref).max(200),
})
export type InterpretedPage = z.infer<typeof InterpretedPageSchema>
