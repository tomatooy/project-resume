import {
  type CandidateQuestion,
  type ControlKind,
  type CoverageGap,
  NATIVE_CONTROL_KINDS,
  normalizeQuestionText,
  type Observation,
  type ObservationNode,
  type ObservedOption,
  type QuestionDisposition,
  type QuestionKind,
  unlabelledWording,
} from "@workspace/resume-core/dom-agent"
import type { ControlEvidence } from "./observation"

/**
 * Candidate questions: what the page is asking, enumerated deterministically.
 *
 * This runs before anything interprets meaning, and it never drops a control it
 * cannot name. Every coverage number in the product is computed against this
 * list, so a question that goes missing here is a question the user never sees
 * filled.
 */

/**
 * Native control to question kind. It reads the control, never the wording:
 * a two-option select stays a single choice even when it says Yes and No,
 * because deciding that it is a yes/no question is an interpretation.
 */
const KIND_BY_CONTROL: Record<ControlKind, QuestionKind> = {
  text: "short_text",
  long_text: "long_text",
  email: "short_text",
  tel: "short_text",
  url: "url",
  number: "number",
  date: "date",
  month: "month",
  select: "single_choice",
  combobox: "single_choice",
  radio_group: "single_choice",
  checkbox_group: "multi_choice",
  // A lone checkbox has exactly two states, which is the only reading its kind
  // supports. What those states mean is still not decided here.
  checkbox: "yes_no",
  button_choice: "single_choice",
  file: "file",
  unknown: "unknown",
}

export function questionKindFor(controlKind: ControlKind): QuestionKind {
  return KIND_BY_CONTROL[controlKind]
}

export type QuestionEnumeration = {
  questions: CandidateQuestion[]
  /** Exactly one entry per question. Never partially filled. */
  dispositions: Record<string, QuestionDisposition>
  /** Questions whose option list has to be read on request. */
  needingOptions: string[]
  /**
   * What the enumeration refused to handle. A question nobody can answer is a
   * gap the audit has to see, not a disposition with nowhere to go.
   */
  gaps: CoverageGap[]
}

/**
 * A question is never dropped for want of wording. A page that named nothing
 * still shows up as a question, marked, so the user can see the gap.
 *
 * Wording comes only from what the page authored. The computed accessible name
 * is deliberately not a source: it is derived from the page and changes when
 * the page's markup or state changes, so two different questions can carry the
 * same one and one question can carry different ones over time. ADR 0001 keeps
 * it out of identity for the same reason.
 */
function wordingFor(
  node: ObservationNode,
  evidence: ControlEvidence | undefined,
  kind: QuestionKind
): string {
  const authored = evidence?.labelText.trim() || node.text?.trim() || ""
  if (authored) return authored.slice(0, 4000)
  return unlabelledWording(kind)
}

/**
 * What can be said about a question before anyone reads it. Only structural
 * facts decide this: a disabled or unreadable control is not something to ask
 * the user about again, and a readonly one is a page value to leave alone.
 *
 * A control that holds more than one selection is refused in this release.
 * Writing one option at a time into a multi-select clears every selection the
 * user already made, and nothing has authorized losing them.
 */
function seededDisposition(node: ObservationNode): {
  disposition: QuestionDisposition
  gap: CoverageGap | null
} {
  const control = node.control
  if (!control) return { disposition: "unsupported", gap: null }
  if (control.kind === "unknown")
    return { disposition: "unsupported", gap: null }
  if (control.disabled) return { disposition: "unsupported", gap: null }
  if (control.multiple || questionKindFor(control.kind) === "multi_choice")
    return {
      disposition: "unsupported",
      gap: {
        scope: node.tag,
        reason: "unsupported",
        detail:
          "a control that holds more than one selection is not filled in this release",
      },
    }
  // Readonly means the page owns this value, which is only a reason to leave it
  // alone when there is a committed value to leave alone. An empty readonly
  // field is a question nobody has answered.
  if (control.readonly)
    return control.value !== null || control.checked !== null
      ? { disposition: "preserved", gap: null }
      : { disposition: "unverified", gap: null }
  return { disposition: "unverified", gap: null }
}

export function candidateQuestions(input: {
  observation: Observation
  evidence: Map<string, ControlEvidence>
  /** nodeRef to the region that contains it. */
  regions: Map<string, string>
  /** nodeRef to the repeated-record container it belongs to. */
  records: Map<string, string>
}): QuestionEnumeration {
  const questions: CandidateQuestion[] = []
  const dispositions: Record<string, QuestionDisposition> = {}
  const needingOptions: string[] = []
  const gaps: CoverageGap[] = []
  let index = 0

  // Observation order is document order, so the list is stable for an unchanged
  // page without sorting anything.
  for (const node of input.observation.nodes) {
    const control = node.control
    if (!control) continue
    index += 1
    const ref = `q${index}`
    const evidence = input.evidence.get(node.ref)
    const kind = questionKindFor(control.kind)

    questions.push({
      ref,
      controlRef: node.ref,
      groupRef: input.regions.get(node.ref) ?? null,
      recordRef: input.records.get(node.ref) ?? null,
      kind,
      controlKind: control.kind,
      text: wordingFor(node, evidence, kind),
      description: evidence?.description ?? null,
      options: control.options,
      requiredness: evidence?.requiredness ?? {
        state: "unknown",
        evidence: [],
      },
      constraints: evidence?.constraints,
      // Scope is what the page itself states. The driver enumerates; deciding
      // that a question is about Portugal is a reading, not an enumeration.
      scope: [],
    })
    const seed = seededDisposition(node)
    dispositions[ref] = seed.disposition
    if (seed.gap) gaps.push(seed.gap)
    if (evidence?.portal) needingOptions.push(ref)
  }

  return { questions, dispositions, needingOptions, gaps }
}

/**
 * Attach options read from a portal to the question that owns them. The option
 * list belongs to the control, not to a question of its own.
 */
export function attachOptions(
  question: CandidateQuestion,
  options: ObservedOption[]
): CandidateQuestion {
  return { ...question, options: options.slice(0, 200) }
}

/**
 * The whole deterministic tier, stated so it stays bounded: a native kind, and
 * wording that matches after normalization. Nothing here reads meaning, so a
 * near miss returns null rather than a guess, and a caller that needs more has
 * to ask the reasoner.
 */
export function exactLabelMatch(
  question: CandidateQuestion,
  labels: readonly string[]
): string | null {
  // The whole tier is confined to native controls, where the browser defines the
  // kind. On a widget whose kind came from reading a role, matching wording
  // exactly would rest on an inference this engine made about the markup.
  if (!question.controlKind || !NATIVE_CONTROL_KINDS.has(question.controlKind))
    return null
  const target = normalizeQuestionText(question.text)
  // A placeholder is not wording: nothing may be matched against it.
  if (!target || target.startsWith("[unlabelled ")) return null
  for (const label of labels)
    if (normalizeQuestionText(label) === target) return label
  return null
}

/** Questions that cannot be answered at all, for the audit to report. */
export function unsupportedQuestions(
  questions: CandidateQuestion[]
): CandidateQuestion[] {
  return questions.filter((question) => question.kind === "unknown")
}

/** Questions that need an answer from the user rather than from sources. */
export function openQuestions(
  questions: CandidateQuestion[],
  dispositions: Record<string, QuestionDisposition | undefined>
): CandidateQuestion[] {
  return questions.filter((question) => {
    const disposition = dispositions[question.ref]
    return disposition === "needs_input" || disposition === "conflict"
  })
}
