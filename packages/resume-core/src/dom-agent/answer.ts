import { z } from "zod"
import { QuestionRefSchema } from "./primitives"
import { type Fact, SourceRefSchema, type SourceRef } from "./source"

export const ProposedValueSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("text"),
    text: z.string().min(1).max(4000),
  }),
  z.strictObject({
    type: z.literal("choice"),
    optionRefs: z.array(z.string().min(1).max(64)).min(1).max(20),
  }),
  z.strictObject({
    type: z.literal("boolean"),
    value: z.boolean(),
    optionRef: z.string().min(1).max(64),
  }),
  z.strictObject({ type: z.literal("number"), number: z.number().finite() }),
  z.strictObject({
    type: z.literal("date"),
    year: z.number().int(),
    month: z.number().int().min(1).max(12).nullable(),
    day: z.number().int().min(1).max(31).nullable(),
  }),
  z.strictObject({ type: z.literal("file") }),
])

/**
 * What was done to the source value. Kept apart from the source reference: the
 * reference proves provenance, this says whether anything was inferred. An
 * unsupported factual inference is not one of these.
 */
export const TransformationSchema = z.enum([
  "copy",
  "format",
  "option_equivalent",
  "user_confirmed",
])

export const AnswerProposalSchema = z.strictObject({
  questionRef: QuestionRefSchema,
  value: ProposedValueSchema,
  transformation: TransformationSchema,
  sources: z.array(SourceRefSchema).min(1).max(8),
  note: z.string().max(400).nullable(),
})

export type ProposedValue = z.infer<typeof ProposedValueSchema>
export type Transformation = z.infer<typeof TransformationSchema>
export type AnswerProposal = z.infer<typeof AnswerProposalSchema>

/** A stable, comparable form of a source reference. */
export function sourceRefKey(ref: SourceRef): string {
  switch (ref.kind) {
    case "resume":
      return `resume:${ref.resumeId}:${ref.versionId ?? "head"}:${ref.nodeId}:${ref.field}`
    case "profile":
      return `profile:${ref.section}:${ref.field}`
    case "saved_answer":
      return `saved_answer:${ref.answerId}`
    case "application_answer":
      return `application_answer:${ref.questionKey}`
    case "user_input":
      return "user_input"
  }
}

/**
 * Every cited source is one the bundle actually holds. Provenance is checked,
 * not trusted: a proposal that cites something absent is unresolved, however
 * confident it reads.
 */
export function citedSourcesExist(
  proposal: AnswerProposal,
  facts: readonly Fact[]
): boolean {
  const known = new Set(facts.map((fact) => sourceRefKey(fact.source)))
  return proposal.sources.every((source) => known.has(sourceRefKey(source)))
}

/**
 * Automatic answers may copy an eligible value, apply an explicit lossless
 * conversion, or select an observed option of equivalent meaning. An explicit
 * user resolution is the only thing that settles anything else.
 */
export function proposalIsAutomatic(proposal: AnswerProposal): boolean {
  return proposal.transformation !== "user_confirmed"
}

/** A user-confirmed value carries no automatic authority and needs no source. */
export function proposalNeedsSource(proposal: AnswerProposal): boolean {
  return proposalIsAutomatic(proposal)
}
