import { z } from "zod"
import { coverageSummary, ObservationCoverageSchema } from "./observation"
import { QuestionRefSchema } from "./primitives"
import {
  type CandidateQuestion,
  QuestionDispositionSchema,
  questionIsSettled,
  unaccountedQuestions,
} from "./question"

/**
 * One thing standing between the page and a truthful `ready`. The report
 * distinguishes these, so a user can tell "I do not know" from "I could not".
 */
export const AuditIssueSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("missing_required"),
    questionRef: QuestionRefSchema,
  }),
  z.strictObject({
    kind: z.literal("conflict"),
    questionRef: QuestionRefSchema,
    candidates: z.array(z.string().max(500)).min(2).max(10),
  }),
  z.strictObject({
    kind: z.literal("failed_control"),
    questionRef: QuestionRefSchema,
    detail: z.string().max(400),
  }),
  z.strictObject({
    kind: z.literal("unverified"),
    questionRef: QuestionRefSchema,
    detail: z.string().max(400),
  }),
  z.strictObject({
    kind: z.literal("unsupported_control"),
    questionRef: QuestionRefSchema,
    detail: z.string().max(400),
  }),
  z.strictObject({
    kind: z.literal("validation_error"),
    questionRef: QuestionRefSchema.nullable(),
    message: z.string().max(600),
  }),
  z.strictObject({
    kind: z.literal("cross_field_inconsistent"),
    questionRefs: z.array(QuestionRefSchema).min(2).max(10),
    detail: z.string().max(400),
  }),
  z.strictObject({
    kind: z.literal("unobserved_region"),
    scope: z.string().max(300),
    detail: z.string().max(400),
  }),
])

export const PageAuditSchema = z.strictObject({
  id: z.string().min(1).max(64),
  observationId: z.string().min(1).max(64),
  observedAt: z.number().int().nonnegative(),
  coverage: ObservationCoverageSchema,
  dispositions: z.record(QuestionRefSchema, QuestionDispositionSchema),
  issues: z.array(AuditIssueSchema).max(500),
  verified: z.array(QuestionRefSchema).max(500),
  /** Values that were already on the page and were left alone. */
  preserved: z.array(QuestionRefSchema).max(500),
})

export type AuditIssue = z.infer<typeof AuditIssueSchema>
export type PageAudit = z.infer<typeof PageAuditSchema>

export type ReadinessVerdict =
  | { state: "ready" }
  | { state: "incomplete"; reasons: string[] }

/**
 * The readiness decision. Coverage, dispositions and issues decide it. The
 * number of writes is not an input, and an optional blank is not a reason to
 * withhold `ready`.
 */
export function readiness(input: {
  audit: PageAudit
  questions: CandidateQuestion[]
}): ReadinessVerdict {
  const { audit, questions } = input
  const reasons: string[] = []

  const unaccounted = unaccountedQuestions(questions, audit.dispositions)
  if (unaccounted.length > 0)
    reasons.push(`Not accounted for: ${unaccounted.join(", ")}`)

  const unresolved = questions
    .filter((question) => {
      const disposition = audit.dispositions[question.ref]
      if (disposition === undefined) return false
      return !questionIsSettled(question, disposition)
    })
    .map((question) => question.ref)
  if (unresolved.length > 0)
    reasons.push(`Unresolved: ${unresolved.join(", ")}`)

  const known = new Set(questions.map((question) => question.ref))
  const stale = Object.keys(audit.dispositions).filter((ref) => !known.has(ref))
  if (stale.length > 0)
    reasons.push(
      `Stale dispositions from another observation: ${stale.join(", ")}`
    )

  if (!audit.coverage.complete) reasons.push(coverageSummary(audit.coverage))

  if (audit.issues.length > 0)
    reasons.push(
      `Issues: ${[...new Set(audit.issues.map((issue) => issue.kind))].join(", ")}`
    )

  return reasons.length === 0
    ? { state: "ready" }
    : { state: "incomplete", reasons }
}

/** Issues that are only ever about a region the run could not read. */
export function issueRefs(issues: readonly AuditIssue[]): string[] {
  const refs: string[] = []
  for (const issue of issues) {
    if (issue.kind === "unobserved_region") continue
    if (issue.kind === "cross_field_inconsistent")
      refs.push(...issue.questionRefs)
    else if (issue.questionRef) refs.push(issue.questionRef)
  }
  return [...new Set(refs)]
}
