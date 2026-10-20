import type { FieldDescriptor, Question } from "@workspace/autofill"
import { describe, expect, it, vi } from "vitest"

import {
  type AnswerInput,
  AnswerInputSchema,
  type AnswerResult,
  AnswerResultSchema,
  type AutofillModels,
  NotesMergeInputSchema,
  NotesMergeResultSchema,
  NotesUndoResultSchema,
} from "../src"
import {
  COUNTS,
  failing,
  field,
  PAGE,
  type Session,
  session,
  USAGE,
  YES_NO,
} from "./autofill-session"
import { only } from "./harness"

const api = field("api", "Have you used Stripe's API before?", "combobox", {
  options: YES_NO,
})
const gender = field("gender", "Gender", "select", {
  options: [
    { id: "#1", label: "Female" },
    { id: "#2", label: "Male" },
  ],
})

function question(
  id: string,
  { id: fieldId, label }: FieldDescriptor,
  options?: string[]
): Question {
  return {
    id,
    text: label,
    original: [{ fieldId, label }],
    ...(options ? { options } : {}),
    companySpecific: false,
  }
}

/** Answers every field it is asked with `value`. */
const answering =
  (value: string): AutofillModels["fillFromAnswer"] =>
  async (input) => ({
    answers: input.fields.map(({ key }) => ({ key, value })),
    usage: USAGE,
  })

/** A merge that adds one fact. */
const adding: AutofillModels["mergeNotes"] = async () => ({
  proposal: {
    ops: [{ op: "add", heading: "Experience", text: "Has used Stripe's API." }],
    hints: [],
  },
  usage: USAGE,
})

/** Answers through the contract, so a shape the schemas refuse fails here. */
async function answer(
  s: Session,
  over: Partial<AnswerInput> = {}
): Promise<AnswerResult> {
  const input = AnswerInputSchema.parse({
    page: PAGE,
    resumeId: s.resumeId,
    applicationId: s.applicationId,
    useJob: false,
    counts: COUNTS,
    fields: [api],
    questions: [question("q1", api, ["Yes", "No"])],
    text: "1. yes, I built a billing tool on it",
    ...over,
  })
  return AnswerResultSchema.parse(await s.h.autofillService.answer(input))
}

describe("AutofillService.answer", () => {
  it("fills from the answer and merges Notes in one run", async () => {
    const s = await session({
      fillFromAnswer: answering("Yes"),
      mergeNotes: adding,
    })

    const result = await answer(s)

    expect(result.fills).toEqual([
      {
        fieldId: "api",
        source: "ai",
        kind: "options",
        optionIds: ["#1"],
        labels: ["Yes"],
      },
    ])
    expect(result.unmatched).toEqual([])
    expect(result.notes).toMatchObject({ kind: "saved", added: 1 })
    expect(only(s.h.db.runs)).toMatchObject({
      kind: "autofill",
      hintSkillId: "autofill.answer",
      status: "completed",
      inputTokens: 20,
      outputTokens: 10,
    })
  })

  it("reports answers that match no option", async () => {
    const s = await session({ fillFromAnswer: answering("Maybe") })

    const result = await answer(s)

    expect(result.fills).toEqual([])
    expect(result.unmatched).toEqual(["q1"])
  })

  it("returns the fill when the merge fails", async () => {
    const s = await session({
      fillFromAnswer: answering("Yes"),
      mergeNotes: failing,
    })

    const result = await answer(s)

    expect(result.notes).toEqual({ kind: "failed" })
    expect(only(result.fills)).toMatchObject({ fieldId: "api" })
  })

  it("never fills a forbidden field from an answer", async () => {
    // The model may only be asked about `api`; a leak would show as a second
    // field in the call and its value here.
    const fillFromAnswer = vi.fn<AutofillModels["fillFromAnswer"]>(
      async (input) => ({
        answers: input.fields.map(({ key, label }) => ({
          key,
          value: label.includes("API") ? "Yes" : "Female",
        })),
        usage: USAGE,
      })
    )
    const mergeNotes = vi.fn(adding)
    const s = await session({ fillFromAnswer, mergeNotes })

    const result = await answer(s, {
      fields: [api, gender],
      questions: [
        question("q1", api, ["Yes", "No"]),
        question("q2", gender, ["Female", "Male"]),
      ],
    })

    expect(result.fills.map(({ fieldId }) => fieldId)).toEqual(["api"])
    expect(fillFromAnswer.mock.calls[0]?.[0].fields).toHaveLength(1)
    const sent = JSON.stringify([
      fillFromAnswer.mock.calls,
      mergeNotes.mock.calls,
    ])
    expect(sent).toContain(api.label)
    expect(sent).not.toContain("Gender")
    expect(sent).not.toContain("Female")
  })
})

describe("AutofillService.notesMerge and notesUndo", () => {
  it("retries a failed merge as its own run", async () => {
    const s = await session({ mergeNotes: adding })

    const result = NotesMergeResultSchema.parse(
      await s.h.autofillService.notesMerge(
        NotesMergeInputSchema.parse({
          page: PAGE,
          resumeId: s.resumeId,
          questions: [question("q1", api, ["Yes", "No"])],
          text: "1. yes",
        })
      )
    )

    expect(result.notes).toMatchObject({ kind: "saved", added: 1 })
    expect(only(s.h.db.runs)).toMatchObject({
      hintSkillId: "autofill.notes.merge",
      status: "completed",
      inputTokens: 10,
    })
  })

  it("undoes a merge for free", async () => {
    const s = await session({ mergeNotes: adding })
    const { notes } = await answer(s)
    if (notes.kind !== "saved" || !notes.undoVersionId) {
      throw new Error("the merge should have saved")
    }

    const undone = NotesUndoResultSchema.parse(
      await s.h.autofillService.notesUndo({
        versionId: notes.undoVersionId,
        revision: notes.revision,
      })
    )

    expect(undone).toEqual({ kind: "restored", revision: notes.revision + 1 })
    expect((await s.h.autofillNotesService.get()).content).toBe("")
    expect(only(s.h.db.runs).hintSkillId).toBe("autofill.answer")
  })
})
