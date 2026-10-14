import { AppError } from "../domain/errors"
import { isUnlabelledWording } from "../dom-agent/question"
import { isoDateText } from "../dom-agent/proposal-rules"
import type { Fact, FactValue } from "../dom-agent/source"
import {
  RemoveSavedAnswerSchema,
  SaveSavedAnswerSchema,
  SavedAnswerSchema,
  isDemographicQuestion,
  savedQuestionKey,
  type SaveSavedAnswer,
  type SavedAnswer,
  type SavedQuestionEvidence,
} from "./schema"

/**
 * Where saved answers are kept. Declared here rather than reusing the legacy
 * repository, because a row in this shape and a row in the concept vocabulary
 * are read and written by different rules even when they share a table.
 */
export interface SavedAnswerRepository {
  list(): Promise<SavedAnswer[]>
  save(
    answer: SavedAnswer,
    expectedRevision: number
  ): Promise<SavedAnswer | null>
  remove(id: string, expectedRevision: number): Promise<boolean>
}

/**
 * The account-level saved answers: answers the user chose to keep, each one
 * addressed by the question's own identity rather than by a vocabulary member.
 *
 * Whether a value may fill a question of a given kind is the gate's decision at
 * fill time (`kindAccepts` in the reasoning protocol), deliberately not copied
 * here: two copies of that rule would be two answers to the same question.
 */
export class SavedAnswerService {
  constructor(
    private readonly repository?: SavedAnswerRepository,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async list(): Promise<SavedAnswer[]> {
    const answers = (await this.repository?.list()) ?? []
    return answers.map((answer) => SavedAnswerSchema.parse(answer))
  }

  async save(raw: unknown): Promise<SavedAnswer> {
    const parsed = SaveSavedAnswerSchema.safeParse(raw)
    if (!parsed.success)
      throw new AppError(
        "VALIDATION",
        "Confirm the question and the answer before saving"
      )
    const input: SaveSavedAnswer = parsed.data
    const evidence = checkedEvidence(input)
    if (input.value.type === "choice")
      throw new AppError(
        "VALIDATION",
        "A choice answer depends on the options a page offers, so it is answered on the page rather than saved"
      )
    if (input.value.type === "text" && !input.value.text.trim())
      throw new AppError("VALIDATION", "An empty answer cannot be saved")
    if (input.value.type === "boolean" && input.value.state === "unknown")
      throw new AppError(
        "VALIDATION",
        "Unknown is the absence of an answer, so there is nothing to save"
      )
    if (input.expectedRevision > 0 && !input.id)
      throw new AppError(
        "VALIDATION",
        "A saved answer needs its id to be updated"
      )
    if (!this.repository)
      throw new AppError("INTERNAL", "Saved answers are unavailable")
    const now = this.clock().toISOString()
    const saved = await this.repository.save(
      {
        id: input.id ?? crypto.randomUUID(),
        revision: input.expectedRevision + 1,
        question: { ...evidence, key: savedQuestionKey(evidence) },
        value: input.value,
        confirmedAt: now,
        updatedAt: now,
      },
      input.expectedRevision
    )
    if (!saved)
      throw new AppError(
        "CONFLICT",
        "Saved answer changed. Reload it before saving"
      )
    return SavedAnswerSchema.parse(saved)
  }

  async remove(raw: unknown): Promise<void> {
    const parsed = RemoveSavedAnswerSchema.safeParse(raw)
    if (!parsed.success)
      throw new AppError("VALIDATION", "Invalid saved answer")
    if (!this.repository)
      throw new AppError("INTERNAL", "Saved answers are unavailable")
    const removed = await this.repository.remove(
      parsed.data.id,
      parsed.data.expectedRevision
    )
    if (!removed)
      throw new AppError(
        "CONFLICT",
        "Saved answer changed. Reload it before removing"
      )
  }
}

/**
 * The refusals that say why rather than storing something vague: no wording, a
 * wording the page generated rather than authored, a demographic question, and
 * a missing scope. Unknown scope is not a wildcard, so reuse needs an explicit
 * one.
 */
function checkedEvidence(input: SaveSavedAnswer): SavedQuestionEvidence {
  // The shape was already checked by the caller's parse, so this only trims
  // and answers the questions a shape cannot: is there wording at all, did a
  // page author it, and is it one that may be kept.
  const evidence: SavedQuestionEvidence = {
    ...input.question,
    text: input.question.text.trim(),
  }
  if (!evidence.text)
    throw new AppError(
      "VALIDATION",
      "A reusable answer needs the question as the page asks it"
    )
  if (isUnlabelledWording(evidence.text))
    throw new AppError(
      "VALIDATION",
      "This field has no wording of its own, so a later page could not recognise it"
    )
  if (isDemographicQuestion(evidence.text))
    throw new AppError(
      "VALIDATION",
      "Demographic answers are never reused; answer them on the page instead"
    )
  if (evidence.scope.length === 0)
    throw new AppError(
      "VALIDATION",
      "Choose the scope this answer may be reused in"
    )
  return evidence
}

/**
 * One saved answer as a source fact. The meaning is the question's own wording,
 * which is what the deterministic tier matches on, so reuse compares the
 * question rather than a vocabulary. The meaning clips to the protocol's limit,
 * so a very long question stays a fact the model can use without becoming one
 * the deterministic tier could bind.
 */
export function factFromSavedAnswer(answer: SavedAnswer): Fact {
  return {
    id: `saved:${answer.id}`,
    meaning: answer.question.text.slice(0, 200),
    display: displayOfSavedValue(answer.value),
    value: answer.value,
    scope: answer.question.scope,
    source: {
      kind: "saved_answer",
      answerId: answer.id,
      questionKey: answer.question.key,
    },
  }
}

/** How a saved value reads to a person. Display is never the value written. */
export function displayOfSavedValue(value: FactValue): string {
  switch (value.type) {
    case "text":
      return value.text.slice(0, 500)
    case "boolean":
      return value.state
    case "number":
      return String(value.number)
    case "money":
      return `${value.amount} ${value.currency} per ${value.period}`
    case "date":
      return isoDateText(value)
    case "choice":
      return value.optionIds.join(", ")
  }
}
