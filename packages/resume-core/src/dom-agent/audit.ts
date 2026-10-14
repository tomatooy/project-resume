import { z } from "zod"
import { DOM_AGENT_LIMITS } from "./limits"
import {
  coverageSummary,
  type ObservedControl,
  type Observation,
  type ObservationNode,
  ObservationCoverageSchema,
} from "./observation"
import { QuestionRefSchema } from "./primitives"
import {
  type CandidateQuestion,
  QuestionDispositionSchema,
  questionIsSettled,
  unaccountedQuestions,
} from "./question"
import type { Receipt } from "./receipt"

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
    // Mirrors `CoverageGap.detail`, which is what this carries.
    detail: z.string().max(600),
  }),
])

export type AuditIssue = z.infer<typeof AuditIssueSchema>

/**
 * A dimension this audit did not check, and why not. An engine limit is not a
 * gap in the page, so none of these blocks readiness; a gap in the page is an
 * `unobserved_region` and does. They are stated because an empty `issues` list
 * would otherwise read as "nothing was wrong" on a page where it only means
 * "not looked at", and ticket 15 puts this in front of a person.
 */
export const UncheckedDimensionSchema = z.strictObject({
  dimension: z.enum([
    "validation_errors",
    "source_conflicts",
    "cross_field_consistency",
  ]),
  reason: z.string().min(1).max(600),
})

export type UncheckedDimension = z.infer<typeof UncheckedDimensionSchema>

/** What no audit can check yet. Each one is a limit of the engine, not a page. */
export const UNCHECKED_DIMENSIONS: readonly UncheckedDimension[] = [
  {
    dimension: "validation_errors",
    reason:
      "The observation carries each control's own state and the page's error wording, but no stated link between an error and the control it belongs to, and alert or status prose is not a failure: the page runtime says the same where it reads one. Validation is never provoked by submitting, so this cannot be checked.",
  },
  {
    dimension: "source_conflicts",
    reason:
      "One question is answered from at most one fact: the interpreter takes the single exact match and the run writes it, so no two candidate answers are ever held side by side. The `conflict` disposition and the `conflict` issue exist with no producer.",
  },
  {
    dimension: "cross_field_consistency",
    reason:
      "The page states its constraints per control and no rule relating two controls, so there is nothing here to compare across fields.",
  },
]

/** One page holds at most one control per observation node. */
const MAX_REPORTED = DOM_AGENT_LIMITS.observationNodes
/** One outcome per question, plus one issue per coverage gap. */
const MAX_ISSUES = MAX_REPORTED + 64

export const PageAuditSchema = z.strictObject({
  id: z.string().min(1).max(64),
  observationId: z.string().min(1).max(64),
  observedAt: z.number().int().nonnegative(),
  coverage: ObservationCoverageSchema,
  dispositions: z.record(QuestionRefSchema, QuestionDispositionSchema),
  issues: z.array(AuditIssueSchema).max(MAX_ISSUES),
  verified: z.array(QuestionRefSchema).max(MAX_REPORTED),
  /** Values that were already on the page and were left alone. */
  preserved: z.array(QuestionRefSchema).max(MAX_REPORTED),
  unchecked: z.array(UncheckedDimensionSchema).max(20),
})

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

/** What one question's own record says about it. */
type Outcome =
  | "verified"
  | "preserved"
  | "unsupported"
  | "failed"
  | "unverified"
  | "missing"
  | "settled"

/**
 * Judge one question. Every disposition lands in exactly one outcome, so a
 * question is counted once and no bucket can quietly absorb another's.
 *
 * The receipt is the page's own word about a write, and the observation is the
 * page's own word about a value that was already there. Neither is inferred
 * from the other: a run observes before it writes, so the observation cannot
 * speak for a write that landed after it.
 */
function outcomeFor(input: {
  question: CandidateQuestion
  control: ObservedControl | null
  disposition: z.infer<typeof QuestionDispositionSchema>
  receipt: Receipt | undefined
}): Outcome {
  const { question, control, disposition, receipt } = input
  switch (disposition) {
    case "answered":
      // Only the page accepting makes it verified. A disposition that says
      // answered with nothing behind it is a write that did not land.
      return receipt?.state === "accepted" ? "verified" : "unverified"
    case "preserved":
      // A value the page owns satisfies the field only when its committed
      // state was actually read. An unread value is not an answer.
      return committedStateObservable(question, control)
        ? "preserved"
        : "unverified"
    case "unsupported":
      return "unsupported"
    case "unverified":
      // A refusal is its own outcome: "the page would not take it" and "the
      // page never said" are different things to the person reading this.
      return receipt?.state === "failed" || receipt?.state === "rejected"
        ? "failed"
        : "unverified"
    case "needs_input":
    case "conflict":
    case "out_of_scope":
    case "optional_blank":
      // The shared rule, not this module's own opinion, so the audit and the
      // verdict can never disagree about whether a question still needs work.
      return questionIsSettled(question, disposition) ? "settled" : "missing"
  }
}

/**
 * True when the page states what a control holds now. An empty string is not a
 * state: a control that reads back no value and no selection has told the audit
 * nothing it may count as a committed value.
 */
function committedStateObservable(
  question: CandidateQuestion,
  control: ObservedControl | null
): boolean {
  if (!control) return false
  if (question.options.some((option) => option.selected)) return true
  if (control.checked !== null) return true
  return control.value !== null && control.value !== ""
}

/** Why nothing could be written here, in the page's own terms. */
function unsupportedDetail(
  question: CandidateQuestion,
  control: ObservedControl | null
): string {
  if (!control) return "No control was read for this question"
  if (control.disabled) return "The page disabled this control"
  if (control.multiple || question.kind === "multi_choice")
    return "This control holds more than one selection, and writing one option at a time would clear the others"
  if (control.kind === "unknown")
    return "The control's own type was not recognised, so nothing can be written into it"
  return "This run has no write for this control"
}

function unverifiedDetail(receipt: Receipt | undefined): string {
  if (!receipt)
    return "An answer was planned for this question and no write reached the page"
  const evidence = receipt.evidence.join(", ")
  return `The page did not confirm the write: ${evidence || "no evidence it returned"}`
}

function failedDetail(receipt: Receipt): string {
  const evidence = receipt.evidence.join(", ")
  return `The page refused the write: ${evidence || "no evidence it returned"}`
}

/** Truncation is a bound on our own sentence, never on the count. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

/**
 * The whole-page verdict, from what the run already holds.
 *
 * Read from the run's own record rather than from a second reading of the page:
 * the observation says what the page states, the receipts say what the page
 * answered, and the dispositions say what became of each question. Nothing here
 * writes, clicks, or submits: validation is never provoked, so a page that only
 * reveals an error on submit reveals it to the person, not to this audit.
 *
 * A cold pass observes before it writes, so `observedAt` can predate the
 * receipts it is judged with. That is why a write is judged by its receipt
 * rather than by looking for the value in the observation.
 */
export function buildPageAudit(input: {
  id: string
  observation: Pick<Observation, "id" | "coverage" | "nodes">
  observedAt: number
  questions: readonly CandidateQuestion[]
  dispositions: Record<
    string,
    z.infer<typeof QuestionDispositionSchema> | undefined
  >
  receipts: readonly Receipt[]
}): PageAudit {
  const nodeByRef = new Map<string, ObservationNode>(
    input.observation.nodes.map((node) => [node.ref, node])
  )
  // The latest receipt decides, the way the run's own dispositions do: a
  // question that failed and was written again on a later pass is not reported
  // as a failure it has since resolved.
  const latest = new Map<string, Receipt>()
  for (const receipt of input.receipts) latest.set(receipt.questionRef, receipt)

  const issues: AuditIssue[] = []
  const verified: string[] = []
  const preserved: string[] = []

  for (const question of input.questions) {
    const disposition = input.dispositions[question.ref]
    // A question nothing accounted for is the verdict's own finding, and the
    // verdict names it. Giving it an outcome here would hide which rule saw it.
    if (disposition === undefined) continue
    const outcome = outcomeFor({
      question,
      control: nodeByRef.get(question.controlRef)?.control ?? null,
      disposition,
      receipt: latest.get(question.ref),
    })
    switch (outcome) {
      case "verified":
        verified.push(question.ref)
        break
      case "preserved":
        preserved.push(question.ref)
        break
      case "settled":
        break
      case "missing":
        issues.push({ kind: "missing_required", questionRef: question.ref })
        break
      case "unsupported":
        issues.push({
          kind: "unsupported_control",
          questionRef: question.ref,
          detail: clip(
            unsupportedDetail(
              question,
              nodeByRef.get(question.controlRef)?.control ?? null
            ),
            400
          ),
        })
        break
      case "failed": {
        const receipt = latest.get(question.ref)
        issues.push({
          kind: "failed_control",
          questionRef: question.ref,
          detail: clip(
            receipt ? failedDetail(receipt) : "The page refused the write",
            400
          ),
        })
        break
      }
      case "unverified":
        issues.push({
          kind: "unverified",
          questionRef: question.ref,
          detail: clip(unverifiedDetail(latest.get(question.ref)), 400),
        })
        break
    }
  }

  // Every region the read could not reach, one issue each: a page with a gap in
  // it can never be ready, and the gap has to be readable as a region rather
  // than only as a failed completeness flag.
  for (const gap of input.observation.coverage.gaps)
    issues.push({
      kind: "unobserved_region",
      scope: gap.scope,
      detail: gap.detail,
    })

  return PageAuditSchema.parse({
    id: input.id,
    observationId: input.observation.id,
    observedAt: input.observedAt,
    coverage: input.observation.coverage,
    // Carried as given, including a ref this observation does not hold: the
    // verdict reports those as stale, and dropping them here would leave that
    // rule with nothing to fire on.
    dispositions: Object.fromEntries(
      Object.entries(input.dispositions).filter(
        (entry): entry is [string, z.infer<typeof QuestionDispositionSchema>] =>
          entry[1] !== undefined
      )
    ),
    issues,
    verified,
    preserved,
    unchecked: [...UNCHECKED_DIMENSIONS],
  })
}
