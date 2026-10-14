import type { ScopedAnswer } from "../autofill/contract"
import {
  StoredAnswerSchema,
  reviewFromStoredAnswer,
  type ReviewAnswer,
} from "../dom-agent/saved-answer"

export type { ReviewAnswer } from "../dom-agent/saved-answer"

/**
 * Why each legacy row cannot be reused, in the terms the account surface shows.
 *
 * This is the read half of the compatibility adapter: the retired concept
 * vocabulary is mapped into the new shape when read, and a row that cannot be
 * mapped safely comes back with its reason rather than as a fact. It lives here
 * rather than being imported from the page-side barrel, which exports the page
 * protocol and deliberately not this reader, so the account surface never pulls
 * a reader into the browser to render a list.
 */
export function legacySavedAnswersReview(
  rows: readonly ScopedAnswer[]
): ReviewAnswer[] {
  return rows.map((row) =>
    reviewFromStoredAnswer(StoredAnswerSchema.parse(row))
  )
}
