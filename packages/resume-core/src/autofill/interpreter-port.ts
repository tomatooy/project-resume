import { z } from "zod"
import { SourceRefSchema, type FieldSnapshot } from "./contract"
import {
  PageInterpretationSchema,
  InterpretedPageSchema,
  PageViewSchema,
  type InterpretedPage,
  type PageNode,
  type PageView,
} from "./page-contract"

export type InterpretPageInput = {
  pageView: PageView
  fields: FieldSnapshot[]
}
export type AutofillModelOptions = {
  signal: AbortSignal
  beforeAttempt: () => Promise<void>
}
export interface AutofillPageInterpreter {
  interpret(
    input: InterpretPageInput,
    options: AutofillModelOptions
  ): Promise<InterpretedPage>
}

function ancestors(node: PageNode, nodes: Map<string, PageNode>): PageNode[] {
  const result: PageNode[] = []
  const seen = new Set([node.ref])
  let parent = node.parentRef ? nodes.get(node.parentRef) : undefined
  while (parent && !seen.has(parent.ref)) {
    result.push(parent)
    seen.add(parent.ref)
    parent = parent.parentRef ? nodes.get(parent.parentRef) : undefined
  }
  return result
}

export function validatePageView(
  pageView: PageView,
  fields: FieldSnapshot[]
): boolean {
  if (!PageViewSchema.safeParse(pageView).success) return false
  const nodes = new Map(pageView.nodes.map((node) => [node.ref, node]))
  const roots = new Set(pageView.roots.map((root) => root.rootId))
  if (
    nodes.size !== pageView.nodes.length ||
    roots.size !== pageView.roots.length
  )
    return false
  const fieldIds = new Set(fields.map((field) => field.fieldId))
  if (fieldIds.size !== fields.length) return false
  const observedFields = new Set<string>()
  for (const node of nodes.values()) {
    if (!roots.has(node.rootId)) return false
    if (node.fieldId) {
      if (
        !fieldIds.has(node.fieldId) ||
        observedFields.has(node.fieldId) ||
        node.ref !== node.fieldId
      )
        return false
      observedFields.add(node.fieldId)
    }
    if (
      node.parentRef &&
      (!nodes.has(node.parentRef) ||
        nodes.get(node.parentRef)?.rootId !== node.rootId)
    )
      return false
    if (node.relations.some((relation) => !nodes.has(relation.ref)))
      return false
    const parents = ancestors(node, nodes)
    const last = parents.at(-1) ?? node
    if (last.parentRef) return false
  }
  return fields.every((field) => observedFields.has(field.fieldId))
}

function isContext(
  node: PageNode,
  evidence: PageNode,
  nodes: Map<string, PageNode>
): boolean {
  if (node.rootId !== evidence.rootId || !evidence.text.trim()) return false
  if (
    node.ref === evidence.ref ||
    node.relations.some((relation) => relation.ref === evidence.ref)
  )
    return true
  const parents = ancestors(node, nodes)
  if (parents.some((parent) => parent.ref === evidence.ref)) return true
  // Direct sibling text and ancestor headings survive layout wrapper removal.
  if (
    node.parentRef &&
    evidence.parentRef === node.parentRef &&
    !evidence.fieldId
  )
    return true
  return (
    !evidence.fieldId &&
    /^(h[1-6]|legend)$/.test(evidence.tag) &&
    parents.some((parent) => parent.ref === evidence.parentRef)
  )
}

export function unresolvedPage(input: InterpretPageInput): InterpretedPage {
  return {
    snapshotId: input.pageView.snapshotId,
    regions: [],
    fields: [],
    groups: [],
    excluded: [],
    needsContext: [],
    unresolvedFieldIds: input.fields.map((field) => field.fieldId),
  }
}

export function reconcilePageInterpretation(
  raw: unknown,
  input: InterpretPageInput
): InterpretedPage | null {
  const parsed = PageInterpretationSchema.or(InterpretedPageSchema).safeParse(
    raw
  )
  if (!parsed.success || !validatePageView(input.pageView, input.fields))
    return null
  const output = parsed.data
  if (output.snapshotId !== input.pageView.snapshotId) return null
  const fields = new Map(input.fields.map((field) => [field.fieldId, field]))
  const nodes = new Map(input.pageView.nodes.map((node) => [node.ref, node]))
  const regions = new Map<string, PageNode>()
  for (const region of output.regions) {
    const node = nodes.get(region.regionRef)
    if (!node || node.fieldId || regions.has(region.regionRef)) return null
    regions.set(region.regionRef, node)
    for (const evidenceRef of region.evidenceRefs) {
      const evidence = nodes.get(evidenceRef)
      if (!evidence || evidence.rootId !== node.rootId || !evidence.text.trim())
        return null
      if (
        evidence.ref !== node.ref &&
        !ancestors(evidence, nodes).some((parent) => parent.ref === node.ref)
      )
        return null
    }
  }
  const accounted = new Set<string>()
  for (const item of [
    ...output.fields,
    ...output.excluded,
    ...output.needsContext,
  ]) {
    if (!fields.has(item.fieldId) || accounted.has(item.fieldId)) return null
    accounted.add(item.fieldId)
  }
  const groupIds = new Set<string>()
  const groupedFields = new Set<string>()
  for (const group of output.groups) {
    const groupNode = nodes.get(group.groupId)
    if (!groupNode || groupNode.fieldId || groupIds.has(group.groupId))
      return null
    groupIds.add(group.groupId)
    const existingGroups = new Set<string>()
    for (const fieldId of group.fieldIds) {
      const node = nodes.get(fieldId)
      const field = fields.get(fieldId)
      if (
        !node ||
        !field ||
        groupedFields.has(fieldId) ||
        node.rootId !== groupNode.rootId
      )
        return null
      if (
        !ancestors(node, nodes).some((parent) => parent.ref === group.groupId)
      )
        return null
      if (field.groupId) existingGroups.add(field.groupId)
      if (
        !output.fields.some(
          (item) => item.fieldId === fieldId && item.groupId === group.groupId
        )
      )
        return null
      groupedFields.add(fieldId)
    }
    if (existingGroups.size > 1) return null
    for (const evidenceRef of group.evidenceRefs) {
      const evidence = nodes.get(evidenceRef)
      if (
        !evidence ||
        evidence.rootId !== groupNode.rootId ||
        !evidence.text.trim()
      )
        return null
      if (
        evidence.ref !== groupNode.ref &&
        !ancestors(evidence, nodes).some(
          (parent) => parent.ref === group.groupId
        )
      )
        return null
    }
  }
  for (const interpretation of output.fields) {
    const field = fields.get(interpretation.fieldId)
    const node = nodes.get(interpretation.fieldId)
    if (!field || !node || interpretation.fieldRevision !== field.fieldRevision)
      return null
    const region = regions.get(interpretation.regionRef)
    if (
      !region ||
      region.rootId !== node.rootId ||
      !ancestors(node, nodes).some((parent) => parent.ref === region.ref)
    )
      return null
    if (interpretation.groupId && !groupedFields.has(interpretation.fieldId))
      return null
    if (
      interpretation.requiresDraft !==
      (interpretation.concept === "open_answer")
    )
      return null
    for (const evidenceRef of interpretation.evidenceRefs) {
      const evidence = nodes.get(evidenceRef)
      if (!evidence || !isContext(node, evidence, nodes)) return null
    }
  }
  for (const excluded of output.excluded) {
    const node = nodes.get(excluded.fieldId)
    if (!node) return null
    for (const evidenceRef of excluded.evidenceRefs) {
      const evidence = nodes.get(evidenceRef)
      if (!evidence || !isContext(node, evidence, nodes)) return null
    }
  }
  const resolved = new Set(
    [...output.fields, ...output.excluded].map((field) => field.fieldId)
  )
  return {
    ...output,
    unresolvedFieldIds: input.fields
      .filter((field) => !resolved.has(field.fieldId))
      .map((field) => field.fieldId),
  }
}

const id = z.string().min(1).max(150)
export const DraftEvidenceSchema = z.strictObject({
  evidenceId: id,
  text: z.string().min(1).max(4000),
  sourceRef: SourceRefSchema,
  confirmed: z.literal(true),
})
export const DraftInputSchema = z.strictObject({
  fieldId: id,
  fieldRevision: z.number().int().nonnegative(),
  question: z.string().min(1).max(4000),
  evidence: z.array(DraftEvidenceSchema).min(1).max(40),
  maxLength: z.number().int().min(1).max(4000).optional(),
})
export type DraftInput = z.infer<typeof DraftInputSchema>
export const DraftResponseSchema = z.strictObject({
  text: z.string().max(4000),
  citations: z
    .array(
      z.strictObject({
        evidenceId: id,
        quote: z.string().min(1).max(4000),
      })
    )
    .max(40),
  missingInformation: z.array(z.string().min(1).max(500)).max(20),
})
export const AutofillDraftSchema = DraftResponseSchema.extend({
  fieldId: id,
  fieldRevision: z.number().int().nonnegative(),
  requiresConfirmation: z.literal(true),
  grounding: z.literal("references_validated"),
  model: id,
})
export type AutofillDraft = z.infer<typeof AutofillDraftSchema>
export interface AutofillDrafter {
  draft(
    input: DraftInput,
    options: AutofillModelOptions
  ): Promise<AutofillDraft>
}

export function validateDraft(
  raw: unknown,
  input: DraftInput,
  model: string
): AutofillDraft | null {
  const parsedInput = DraftInputSchema.safeParse(input)
  const parsed = DraftResponseSchema.safeParse(raw)
  if (!parsedInput.success || !parsed.success) return null
  const evidence = new Map(
    input.evidence.map((item) => [item.evidenceId, item])
  )
  if (evidence.size !== input.evidence.length) return null
  const draft = parsed.data
  if (draft.text.length > (input.maxLength ?? 4000)) return null
  if (draft.text.trim() && !draft.citations.length) return null
  if (!draft.text.trim() && !draft.missingInformation.length) return null
  for (const citation of draft.citations) {
    if (!evidence.get(citation.evidenceId)?.text.includes(citation.quote))
      return null
  }
  return {
    ...draft,
    fieldId: input.fieldId,
    fieldRevision: input.fieldRevision,
    requiresConfirmation: true,
    grounding: "references_validated",
    model,
  }
}
