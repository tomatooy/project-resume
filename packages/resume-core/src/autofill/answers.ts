import { AppError } from "../domain/errors"
import {
  DeleteScopedAnswerSchema,
  SaveScopedAnswerSchema,
  ScopedAnswerSchema,
  type AnswerConditions,
  type AnswerMeaning,
  type ApplicationContext,
  type DeleteScopedAnswer,
  type FieldSnapshot,
  type SaveScopedAnswer,
  type ScopedAnswer,
} from "./contract"
import type { Concept } from "./concept"
import { normalize } from "./rules"
import { explicitCountry } from "../autofill-profile/countries"
import { EEO_DEFINITIONS } from "../autofill-profile/schema"

export interface ScopedAnswerRepository {
  list(): Promise<ScopedAnswer[]>
  save(
    answer: ScopedAnswer,
    expectedRevision: number
  ): Promise<ScopedAnswer | null>
  remove(id: string, expectedRevision: number): Promise<boolean>
}

export function meaningfulAnswer(value: string): boolean {
  return Boolean(value.trim()) && normalize(value) !== "unknown"
}

export function conditionsMatch(
  conditions: AnswerConditions,
  context: AnswerConditions | ApplicationContext
): boolean {
  return Object.entries(conditions).every(
    ([key, value]) =>
      value !== undefined &&
      Object.entries(context).some(([k, v]) => k === key && v === value)
  )
}

export function meaningForField(
  field: FieldSnapshot,
  concept: Concept
): AnswerMeaning {
  return {
    concept,
    ...(concept === "open_answer" || concept.startsWith("eeo_")
      ? { questionKey: normalize(`${field.label}\n${field.description}`) }
      : {}),
    ...(concept.startsWith("eeo_")
      ? {
          definitionVersion: EEO_DEFINITIONS.some(
            (definition) =>
              `eeo_${definition.key}` === concept &&
              normalize(definition.title) === normalize(field.label) &&
              !field.description.trim()
          )
            ? "vs-us-1"
            : "question-v1",
        }
      : {}),
  }
}

export function conditionsForField(
  field: FieldSnapshot,
  countryCode?: string,
  context?: ApplicationContext
): AnswerConditions {
  const explicit = explicitCountry(`${field.label} ${field.description}`)
  const country =
    explicit === "ambiguous"
      ? undefined
      : (explicit ?? countryCode ?? context?.countryCode)
  const text = `${field.label} ${field.description}`
  const currencies = [
    ...new Set(
      text
        .match(
          /\b(?:USD|CAD|AUD|NZD|EUR|GBP|JPY|CHF|CNY|INR|SGD|HKD|KRW|BRL|MXN|ZAR|SEK|NOK|DKK|PLN|AED)\b/gi
        )
        ?.map((currency) => currency.toUpperCase())
    ),
  ]
  const periodCandidates: (NonNullable<
    AnswerConditions["salaryPeriod"]
  > | null)[] = [
    /\b(?:per hour|hourly)\b/i.test(text) ? "hour" : null,
    /\b(?:per month|monthly)\b/i.test(text) ? "month" : null,
    /\b(?:per year|yearly|annual|annually)\b/i.test(text) ? "year" : null,
  ]
  const periods = periodCandidates.filter((period) => period !== null)
  const currency =
    currencies.length > 1 ? undefined : (currencies[0] ?? context?.currency)
  const salaryPeriod =
    periods.length > 1 ? undefined : (periods[0] ?? context?.salaryPeriod)
  return {
    ...(country ? { countryCode: country } : {}),
    ...(context?.employerId ? { employerId: context.employerId } : {}),
    ...(context?.jobId ? { jobId: context.jobId } : {}),
    ...(currency ? { currency } : {}),
    ...(salaryPeriod ? { salaryPeriod } : {}),
  }
}

export function hasRequiredConditions(
  meaning: AnswerMeaning,
  conditions: AnswerConditions
): boolean {
  if (
    /^(work_authorized|sponsorship_|eeo_)/.test(meaning.concept) &&
    !conditions.countryCode
  )
    return false
  if (
    meaning.concept.startsWith("eeo_") &&
    meaning.definitionVersion === "vs-us-1" &&
    conditions.countryCode !== "US"
  )
    return false
  return (
    meaning.concept !== "salary" ||
    Boolean(conditions.currency && conditions.salaryPeriod)
  )
}

export function meaningsMatch(
  answer: AnswerMeaning,
  question: AnswerMeaning
): boolean {
  return (
    answer.concept === question.concept &&
    (!answer.questionKey || answer.questionKey === question.questionKey) &&
    (!answer.definitionVersion ||
      answer.definitionVersion === question.definitionVersion)
  )
}

export function isRecordConcept(concept: Concept): boolean {
  return /^(experience_|education_|current_employer$|recent_employer$)/.test(
    concept
  )
}

export class ScopedAnswerService {
  constructor(
    private readonly repository?: ScopedAnswerRepository,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async list(): Promise<ScopedAnswer[]> {
    const answers = (await this.repository?.list()) ?? []
    return answers.map((answer) => ScopedAnswerSchema.parse(answer))
  }

  async save(raw: SaveScopedAnswer): Promise<ScopedAnswer> {
    const parsed = SaveScopedAnswerSchema.safeParse(raw)
    if (!parsed.success)
      throw new AppError(
        "VALIDATION",
        "Confirm the answer and its reuse conditions before saving"
      )
    const input = parsed.data
    if (
      !meaningfulAnswer(input.value) ||
      !hasRequiredConditions(input.meaning, input.conditions) ||
      isRecordConcept(input.meaning.concept) ||
      ["unmapped", "ambiguous"].includes(input.meaning.concept) ||
      Object.values(input.conditions).every((value) => value === undefined) ||
      (input.expectedRevision > 0 && !input.id)
    )
      throw new AppError(
        "VALIDATION",
        "Saved answers need a supported meaning and explicit reuse conditions"
      )
    if (!this.repository)
      throw new AppError("INTERNAL", "Saved answers are unavailable")
    const now = this.clock().toISOString()
    const saved = await this.repository.save(
      {
        id: input.id ?? crypto.randomUUID(),
        revision: input.expectedRevision + 1,
        meaning: input.meaning,
        conditions: input.conditions,
        value: input.value,
        provenance: input.provenance,
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
    return ScopedAnswerSchema.parse(saved)
  }

  async remove(raw: DeleteScopedAnswer): Promise<void> {
    const parsed = DeleteScopedAnswerSchema.safeParse(raw)
    if (!parsed.success)
      throw new AppError("VALIDATION", "Invalid saved answer")
    if (!this.repository)
      throw new AppError("INTERNAL", "Saved answers are unavailable")
    if (
      !(await this.repository.remove(
        parsed.data.id,
        parsed.data.expectedRevision
      ))
    )
      throw new AppError(
        "CONFLICT",
        "Saved answer changed. Reload it before removing"
      )
  }
}
