import { createServerFn } from "@tanstack/react-start"
import {
  legacySavedAnswersReview,
  type ReviewAnswer,
} from "@workspace/resume-core"
import { serve } from "../handler"

/**
 * The rows the account surface has to show as unresolvable, each with the
 * reason it cannot be reused.
 *
 * Computed here rather than in the browser, because the classifier is part of
 * the page-side reader and the account surface has no business bundling a
 * reader to render a list. The rows belong to the retired concept vocabulary,
 * which this surface reads but never writes: the answer is resolved on the page
 * it was asked on, or removed here. */
export const savedAnswersReview = createServerFn({ method: "GET" }).handler(
  serve(
    async ({ services }): Promise<ReviewAnswer[]> =>
      legacySavedAnswersReview(await services.autofillAnswers.list())
  )
)
