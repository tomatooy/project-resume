import { z } from "zod"
import { DOM_AGENT_LIMITS } from "./limits"
import {
  ControlKindSchema,
  NodeRefSchema,
  ObservedOptionSchema,
  RecordRefSchema,
} from "./primitives"

/**
 * One browser context the run can reach: a document, an out-of-process frame,
 * or an open shadow root. References are only meaningful inside their context,
 * and no two contexts are ever joined by numeric identifier or accessible text.
 */
export const ObservationContextSchema = z.strictObject({
  id: z.string().min(1).max(64),
  kind: z.enum(["document", "frame", "shadow_root"]),
  url: z.string().max(2000).nullable(),
  generation: z.string().min(1).max(64),
  accessible: z.boolean(),
})

export const ObservedControlSchema = z.strictObject({
  kind: ControlKindSchema,
  value: z.string().max(2000).nullable(),
  checked: z.boolean().nullable(),
  multiple: z.boolean(),
  readonly: z.boolean(),
  disabled: z.boolean(),
  options: z.array(ObservedOptionSchema).max(200),
  /** The `accept` attribute of a file input, or null. */
  accepts: z.string().max(200).nullable(),
})

export const ObservationNodeSchema = z.strictObject({
  ref: NodeRefSchema,
  contextId: z.string().min(1).max(64),
  parentRef: NodeRefSchema.nullable(),
  kind: z.enum(["document", "element", "text", "group"]),
  tag: z.string().max(80),
  /** Role as the accessibility tree exposes it. */
  role: z.string().max(100).nullable(),
  /** Computed accessible name. Never an identifier: names repeat. */
  name: z.string().max(2000).nullable(),
  /** Original visible text, preserved alongside any computed name. */
  text: z.string().max(2000).nullable(),
  control: ObservedControlSchema.nullable(),
})

export const ObservationRegionSchema = z.strictObject({
  ref: z.string().min(1).max(32),
  label: z.string().max(500),
  nodeRefs: z.array(NodeRefSchema).max(200),
  recordRef: RecordRefSchema.nullable(),
})

/**
 * A region the run could not read. Recorded rather than dropped: an unreachable
 * region keeps the page out of `ready`, and truncation must never quietly
 * reduce the completeness count.
 */
export const CoverageGapSchema = z.strictObject({
  scope: z.string().max(300),
  reason: z.enum([
    "truncated",
    "inaccessible",
    "unsupported",
    "cross_origin",
    "closed_shadow",
    "budget",
  ]),
  detail: z.string().max(600),
})

export const ObservationCoverageSchema = z.strictObject({
  complete: z.boolean(),
  gaps: z.array(CoverageGapSchema).max(64),
})

export const ObservationSchema = z.strictObject({
  id: z.string().min(1).max(64),
  contexts: z.array(ObservationContextSchema).max(64),
  nodes: z.array(ObservationNodeSchema).max(DOM_AGENT_LIMITS.observationNodes),
  regions: z
    .array(ObservationRegionSchema)
    .max(DOM_AGENT_LIMITS.observationRegions),
  coverage: ObservationCoverageSchema,
})

export type ObservationContext = z.infer<typeof ObservationContextSchema>
export type ObservedControl = z.infer<typeof ObservedControlSchema>
export type ObservationNode = z.infer<typeof ObservationNodeSchema>
export type ObservationRegion = z.infer<typeof ObservationRegionSchema>
export type CoverageGap = z.infer<typeof CoverageGapSchema>
export type ObservationCoverage = z.infer<typeof ObservationCoverageSchema>
export type Observation = z.infer<typeof ObservationSchema>

const join = (...parts: string[]): string => parts.join(", ")

/**
 * Coverage a reader can trust: complete only when nothing was left unread.
 * A gap of any kind is reported, including gaps inside otherwise readable
 * regions, so completeness is never inferred from a node count.
 */
export function observationCoverage(
  gaps: CoverageGap[],
  complete: boolean
): ObservationCoverage {
  return { complete: complete && gaps.length === 0, gaps }
}

export function coverageSummary(coverage: ObservationCoverage): string {
  if (coverage.complete) return "Complete"
  const reasons = [...new Set(coverage.gaps.map((gap) => gap.reason))]
  return join(
    `Incomplete: ${coverage.gaps.length} gap${coverage.gaps.length === 1 ? "" : "s"}`,
    reasons.join("/")
  )
}
