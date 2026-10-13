import {
  ApplicationAnswerSchema,
  conditionsForField,
  meaningForField,
  type ApplicationAnswer,
  type Concept,
  type FieldSnapshot,
  type PlanInput,
} from "@workspace/resume-core/contracts"
import type { AutofillSession } from "./messages"

type Selection = PlanInput["selections"][number]

export function rememberAnswer(
  session: AutofillSession,
  field: FieldSnapshot,
  concept: Concept,
  value: string,
  recordId?: string,
  provenance?: ApplicationAnswer["provenance"]["kind"]
) {
  if (!session.applicationContext || !session.sourceStamp)
    throw new Error("Observe the page first")
  const decision = session.decisions.find(
    (item) => item.fieldId === field.fieldId
  )
  const draft = session.drafts.find(
    (item) => item.fieldId === field.fieldId && item.text === value
  )
  const answer = ApplicationAnswerSchema.parse({
    answerId: crypto.randomUUID(),
    applicationId: session.applicationContext.applicationId,
    meaning:
      decision?.meaning?.concept === concept
        ? decision.meaning
        : meaningForField(field, concept),
    conditions: conditionsForField(
      field,
      session.countryCode,
      session.applicationContext
    ),
    recordId,
    value,
    confirmed: true,
    provenance: {
      kind: provenance ?? (draft ? "confirmed_draft" : "user"),
      sourceStamp: session.sourceStamp,
    },
  })
  session.applicationAnswers = [
    ...session.applicationAnswers.filter(
      (previous) =>
        previous.recordId !== answer.recordId ||
        JSON.stringify(previous.meaning) !== JSON.stringify(answer.meaning) ||
        JSON.stringify(previous.conditions) !==
          JSON.stringify(answer.conditions)
    ),
    answer,
  ].slice(-200)
  session.sourceStamp.overridesRevision++
}

function confirmedOptionValue(field: FieldSnapshot, selection: Selection) {
  const ids = selection.optionIds
  if (!ids) return undefined
  const options = field.options
  const multiple =
    field.control === "multi_select" || field.control === "checkbox_group"
  if (
    !options ||
    ![
      "single_select",
      "multi_select",
      "radio_group",
      "checkbox_group",
    ].includes(field.control) ||
    options.fieldId !== field.fieldId ||
    options.fieldRevision !== field.fieldRevision ||
    options.loadState !== "ready" ||
    selection.optionsRevision !== options.optionsRevision ||
    selection.queryRevision !== options.queryRevision ||
    !ids.length ||
    (!multiple && ids.length !== 1) ||
    new Set(ids).size !== ids.length
  )
    throw new Error("Options changed. Review the current choices again.")
  const labels = ids.map((id) => {
    const matching = options.options.filter((option) => option.optionId === id)
    const option = matching[0]
    if (
      matching.length !== 1 ||
      !option ||
      option.disabled ||
      option.placeholder ||
      !option.label.trim()
    )
      throw new Error("Options changed. Review the current choices again.")
    return option.label
  })
  const value = labels.join(", ")
  if (value.length > 4000)
    throw new Error("This answer is too long to remember")
  return value
}

export function acceptConfirmation(
  session: AutofillSession,
  selection: Selection,
  override?: PlanInput["overrides"][number]
) {
  const field = session.observation?.snapshot?.fields.find(
    (item) => item.fieldId === selection.fieldId
  )
  if (
    !field ||
    field.guardRef !== selection.guardRef ||
    field.fieldRevision !== selection.fieldRevision
  )
    throw new Error("Field changed. Fill the current page again.")
  if (
    !selection.confirmed ||
    !session.sourceStamp ||
    selection.profileRevision !== session.sourceStamp.profileRevision ||
    selection.concept === "ambiguous" ||
    selection.concept === "unmapped"
  )
    throw new Error("Confirm this answer first")
  if (
    selection.replace &&
    !session.replacementPreviews.some(
      (preview) =>
        preview.fieldId === field.fieldId &&
        preview.guardRef === field.guardRef &&
        preview.fieldRevision === field.fieldRevision
    )
  )
    throw new Error("Preview the existing answer first")
  if (
    override &&
    (override.fieldId !== field.fieldId ||
      override.concept !== selection.concept)
  )
    throw new Error("Confirm this answer first")
  const optionValue = confirmedOptionValue(field, selection)
  if (override || optionValue !== undefined)
    rememberAnswer(
      session,
      field,
      selection.concept,
      override?.value ?? optionValue ?? "",
      selection.recordId,
      override ? undefined : "user"
    )
  session.selections = [
    ...session.selections.filter((item) => item.fieldId !== field.fieldId),
    selection,
  ]
  session.overrides = session.overrides.filter(
    (item) => item.fieldId !== field.fieldId
  )
  if (override)
    session.overrides.push({ ...override, documentId: session.documentId })
}
