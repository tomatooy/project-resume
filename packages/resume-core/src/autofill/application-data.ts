import { indexNodes, type Resume } from "@workspace/resume-schema"
import { AppError } from "../domain/errors"
import type {
  ApplicationAnswer,
  AnswerConditions,
  Fact,
  SupplementalRecord,
} from "./contract"
import {
  conditionsMatch,
  hasRequiredConditions,
  isRecordConcept,
  meaningfulAnswer,
} from "./answers"

export function supplementalRecordsFor(
  resume: Resume,
  records: SupplementalRecord[] = [],
  applicationId?: string
): SupplementalRecord[] {
  const scoped = records.filter(
    (record) => record.applicationId === applicationId
  )
  const ids = new Set(indexNodes(resume).keys())
  for (const { record } of scoped) {
    for (const id of [
      record.id,
      ...record.bullets.map((bullet) => bullet.id),
    ]) {
      if (ids.has(id))
        throw new AppError(
          "VALIDATION",
          "Supplemental records need unique identities"
        )
      ids.add(id)
    }
  }
  return scoped
}

export function draftFactsFor(
  facts: Fact[],
  answers: ApplicationAnswer[] = [],
  context: AnswerConditions,
  applicationId?: string
): Fact[] {
  const eligible = (concept: Fact["concept"]) =>
    concept === "display_name" ||
    concept === "summary" ||
    isRecordConcept(concept)
  const safe = facts.filter((fact) => !fact.sensitive && eligible(fact.concept))
  const confirmed = answers.filter(
    (answer) =>
      answer.applicationId === applicationId &&
      eligible(answer.meaning.concept) &&
      meaningfulAnswer(answer.value) &&
      hasRequiredConditions(answer.meaning, answer.conditions) &&
      conditionsMatch(answer.conditions, context) &&
      (!isRecordConcept(answer.meaning.concept) ||
        Boolean(
          answer.recordId &&
            safe.some((fact) => fact.recordId === answer.recordId)
        ))
  )
  const key = (concept: Fact["concept"], recordId?: string) =>
    `${concept}:${recordId ?? "single"}`
  const overridden = new Set(
    confirmed.map((answer) => key(answer.meaning.concept, answer.recordId))
  )
  const result = safe.filter(
    (fact) => !overridden.has(key(fact.concept, fact.recordId))
  )
  for (const answer of confirmed) {
    if (
      confirmed.filter(
        (other) =>
          key(other.meaning.concept, other.recordId) ===
          key(answer.meaning.concept, answer.recordId)
      ).length !== 1
    )
      continue
    result.push({
      factId: answer.answerId,
      concept: answer.meaning.concept,
      value: answer.value,
      recordId: answer.recordId,
      sourceRef: {
        kind: "application_answer",
        key: answer.meaning.concept,
        answerId: answer.answerId,
        applicationId: answer.applicationId,
        recordId: answer.recordId,
      },
      sourceLabel: "Confirmed for this application",
      sensitive: false,
      aliases: [],
    })
  }
  return result
}
