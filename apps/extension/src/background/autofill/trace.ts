import type { FieldDescriptor, Fill } from "@workspace/autofill/fields"
import type {
  AnswerResult,
  InferResult,
  PlanResult,
} from "@workspace/resume-core/contracts"
import { fillText, traceTable } from "../../autofill/debug"
import type { AutofillSession } from "./session"

/*
 * The service worker's half of the autofill trace (`autofill/debug.ts`):
 * one table per pass step, kept apart from the pass logic.
 */

const labelOf = (fields: FieldDescriptor[], fieldId: string): string =>
  fields.find(({ id }) => id === fieldId)?.label ?? fieldId

/** What each fill sent to the page came to. */
export function traceWrites(
  session: AutofillSession,
  fills: Fill[],
  results: Record<string, string>
): void {
  traceTable(
    "6. write results (the page console says why)",
    fills.map((fill) => ({
      field: labelOf(session.fields, fill.fieldId),
      source: fill.source,
      value: fillText(fill),
      outcome: results[fill.fieldId] ?? "no reply",
    }))
  )
}

/** What the rules decided for each field. */
export function tracePlan(session: AutofillSession, plan: PlanResult): void {
  const fills = new Map(
    [...plan.fills, ...plan.overwrites].map((fill): [string, Fill] => [
      fill.fieldId,
      fill,
    ])
  )
  const job = plan.job
    ? `${plan.job.company} / ${plan.job.title} (${plan.jobMatch})`
    : "none"
  traceTable(
    `4. plan from the server's rules. Job target: ${job}. Routes: rule = a rule fills it, ai = AI decides, filled = it has a value, skip = optional and not in your Profile, page = left to you, write = Write with AI, pending = options not read yet`,
    plan.classes.map(({ fieldId, key, zone, route }) => {
      const fill = fills.get(fieldId)
      return {
        field: labelOf(session.fields, fieldId),
        key: key ?? "",
        zone,
        route,
        rule: fill ? fillText(fill) : "",
      }
    })
  )
}

/** Why each AI-route field was or was not sent to AI. */
export function traceTargets(
  session: AutofillSession,
  routes: ReadonlyMap<string, string>,
  targets: FieldDescriptor[],
  aiFields: FieldDescriptor[],
  autoPasses: number
): void {
  const sent = new Set(aiFields.map(({ id }) => id))
  const targeted = new Set(targets.map(({ id }) => id))
  const rows = session.fields.flatMap((field) => {
    if (routes.get(field.id) !== "ai") return []
    const why = sent.has(field.id)
      ? "sent to AI"
      : !targeted.has(field.id)
        ? "AI tried it in an earlier pass; Autofill tries again"
        : session.states[field.id]?.owned === true
          ? "you changed it, so it is yours"
          : `automatic passes used up (${autoPasses}); click Autofill`
    return [{ field: field.label, why }]
  })
  traceTable(`5. ${aiFields.length} field(s) go to AI`, rows)
}

/** Where each field sent to AI ended up. */
export function traceInfer(
  fields: FieldDescriptor[],
  result: InferResult
): void {
  const fills = new Map(
    result.fills.map((fill): [string, Fill] => [fill.fieldId, fill])
  )
  const write = new Set(result.write)
  const page = new Set(result.page)
  traceTable(
    `8. AI result${result.degraded ? " (degraded: a model call failed, timed out or is not configured)" : ""}; AI calls left this hour: ${result.quota.remaining}. The server terminal shows each model verdict.`,
    fields.map((field) => {
      const fill = fills.get(field.id)
      const question = result.questions.find(({ original }) =>
        original.some(({ fieldId }) => fieldId === field.id)
      )
      return {
        field: field.label,
        outcome: fill
          ? "fill"
          : write.has(field.id)
            ? "Write with AI"
            : page.has(field.id)
              ? "left to you on the page"
              : question
                ? "question in the panel"
                : "nothing",
        detail: fill ? fillText(fill) : (question?.text ?? ""),
      }
    })
  )
}

/** What the user's reply filled. */
export function traceAnswer(
  fields: FieldDescriptor[],
  result: AnswerResult
): void {
  traceTable(
    `9. filled from your reply; notes ${result.notes.kind}; answered with no matching option: ${result.unmatched.length}`,
    result.fills.map((fill) => ({
      field: labelOf(fields, fill.fieldId),
      value: fillText(fill),
    }))
  )
}
