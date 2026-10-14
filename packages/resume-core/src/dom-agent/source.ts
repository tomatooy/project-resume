import { z } from "zod"
import {
  TemplateIdSchema,
  TemplateOptionsSchema,
} from "@workspace/resume-schema"
import { byCodeUnit, canonical, fingerprint } from "./fingerprint"
import { ScopeEntrySchema } from "./primitives"

/**
 * Where a fact came from. Provenance proves where a value came from, never
 * that an inference drawn from it is valid.
 */
export const SourceRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("resume"),
    resumeId: z.uuid(),
    versionId: z.uuid().nullable(),
    nodeId: z.string().min(1).max(64),
    field: z.string().min(1).max(80),
  }),
  z.strictObject({
    kind: z.literal("profile"),
    section: z.string().min(1).max(80),
    field: z.string().min(1).max(80),
  }),
  z.strictObject({
    kind: z.literal("saved_answer"),
    answerId: z.uuid(),
    questionKey: z.string().length(16),
  }),
  z.strictObject({
    kind: z.literal("application_answer"),
    questionKey: z.string().length(16),
  }),
  z.strictObject({ kind: z.literal("user_input") }),
])

/**
 * A fact's value. `unknown`, `no` and `decline` are three different answers
 * and stay distinguishable all the way to the control.
 */
export const FactValueSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text: z.string().max(4000) }),
  z.strictObject({
    type: z.literal("boolean"),
    state: z.enum(["yes", "no", "unknown", "decline"]),
  }),
  z.strictObject({ type: z.literal("number"), number: z.number().finite() }),
  z.strictObject({
    type: z.literal("money"),
    amount: z.number().finite(),
    currency: z.string().length(3),
    period: z.enum(["hour", "month", "year"]),
  }),
  z.strictObject({
    type: z.literal("date"),
    year: z.number().int(),
    month: z.number().int().min(1).max(12).nullable(),
    day: z.number().int().min(1).max(31).nullable(),
  }),
  z.strictObject({
    type: z.literal("choice"),
    optionIds: z.array(z.string().min(1).max(80)).max(20),
  }),
])

/**
 * One piece of applicant information. Meaning, display text and the value
 * written into a control are three different things and are kept apart.
 */
export const FactSchema = z.strictObject({
  id: z.string().min(1).max(80),
  /** What the fact means, for matching against a question. */
  meaning: z.string().min(1).max(200),
  /** How the fact reads to a person. */
  display: z.string().max(500),
  value: FactValueSchema,
  scope: z.array(ScopeEntrySchema).max(10),
  source: SourceRefSchema,
})

/** One contributing source version, so a bundle can be identified exactly. */
export const SourceVersionSchema = z.strictObject({
  kind: z.enum(["resume", "profile", "saved_answers"]),
  id: z.string().min(1).max(80),
  revision: z.number().int().nonnegative(),
  contentHash: z.string().max(128),
})

export const RenderConfigSchema = z.strictObject({
  templateId: TemplateIdSchema,
  templateOptions: TemplateOptionsSchema,
  locale: z.string().max(35).nullable(),
  /** Rendering and font asset version, so cached bytes cannot outlive a font. */
  renderVersion: z.string().min(1).max(40),
})

/**
 * The pinned set of sources one application is answered from. Fixed once, so a
 * later edit in the main app cannot change what a run in flight is answering
 * from.
 */
export const SourceBundleSchema = z.strictObject({
  id: z.string().min(1).max(64),
  resumeId: z.uuid(),
  resumeVersionId: z.uuid().nullable(),
  sources: z.array(SourceVersionSchema).max(16),
  facts: z.array(FactSchema).max(400),
  render: RenderConfigSchema,
})

export type SourceRef = z.infer<typeof SourceRefSchema>
export type FactValue = z.infer<typeof FactValueSchema>
export type Fact = z.infer<typeof FactSchema>
export type SourceVersion = z.infer<typeof SourceVersionSchema>
export type RenderConfig = z.infer<typeof RenderConfigSchema>
export type SourceBundle = z.infer<typeof SourceBundleSchema>

/** Identity of a bundle: every contributing version, not just the resume. */
export function sourceBundleId(sources: readonly SourceVersion[]): string {
  return fingerprint(
    canonical(
      sources
        .map(
          (source) =>
            `${source.kind}:${source.id}:${source.revision}:${source.contentHash}`
        )
        .sort(byCodeUnit)
    )
  )
}

/**
 * Identity of a rendered PDF. The resume alone is not enough: a template,
 * option, locale or font asset change produces different bytes for the same
 * document, and attaching stale bytes is worse than re-rendering.
 */
export function pdfIdentity(
  sourceBundle: string,
  render: RenderConfig
): string {
  return fingerprint(
    canonical([sourceBundle, render.renderVersion, pdfKey(render)])
  )
}

function pdfKey(render: RenderConfig): string {
  return canonical([
    render.templateId,
    render.locale ?? "",
    canonical(
      Object.entries(render.templateOptions)
        .map(([key, value]) => `${key}=${String(value)}`)
        .sort(byCodeUnit)
    ),
  ])
}
