import { z } from "zod"
import { QuestionRefSchema } from "./primitives"
import type { CandidateQuestion } from "./question"

/**
 * Which upload field the selected resume belongs in.
 *
 * A page can offer two different things that both mention a resume: the field
 * the attachment goes in, and an area that reads a resume to fill the form
 * itself. They are different targets, and filling the second one would hand the
 * page a document as a side effect of an import the run never chose to start.
 * Only the attachment field is ever the target.
 */

/** Wording a page uses for the document itself. Diacritics are folded first. */
const RESUME_WORDING = /(?:^|[^a-z])(resume|cv|curriculum vitae)(?:[^a-z]|$)/

/**
 * Wording a page uses for an area that reads a resume to fill the form. Checked
 * before the resume wording, because "autofill from resume" names a resume too
 * and only this half says what the control actually does.
 */
const IMPORT_WORDING =
  /(?:^|[^a-z])(autofill|auto-fill|import|parse|extract|prefill|pre-fill)(?:[^a-z]|$)/

export const FileFieldSchema = z.strictObject({
  questionRef: QuestionRefSchema,
  /** The page's own wording, so a run can show which field it means. */
  wording: z.string().min(1).max(4000),
})
export type FileField = z.infer<typeof FileFieldSchema>

export const AttachmentTargetsSchema = z.strictObject({
  /** The one field the resume is attached to, or null when none is identified. */
  target: FileFieldSchema.nullable(),
  /** Areas that import a resume to fill the form. Retained, never filled. */
  importAreas: z.array(FileFieldSchema).max(20),
  /** Upload fields whose wording does not say what they are. */
  unidentified: z.array(QuestionRefSchema).max(20),
  /** More than one field claims to be the resume. The user decides. */
  ambiguous: z.array(QuestionRefSchema).max(20),
})
export type AttachmentTargets = z.infer<typeof AttachmentTargetsSchema>

export function attachmentTargets(
  questions: readonly CandidateQuestion[]
): AttachmentTargets {
  const importAreas: FileField[] = []
  const resumeFields: FileField[] = []
  const unidentified: string[] = []

  for (const question of questions) {
    // Only a control the page made a file input can receive bytes.
    if (question.kind !== "file") continue
    const wording = fold(question.text)
    const field = { questionRef: question.ref, wording: question.text }
    if (IMPORT_WORDING.test(wording)) {
      importAreas.push(field)
      continue
    }
    if (RESUME_WORDING.test(wording)) {
      resumeFields.push(field)
      continue
    }
    unidentified.push(question.ref)
  }

  const only = resumeFields.length === 1 ? resumeFields[0] : undefined
  return AttachmentTargetsSchema.parse({
    target: only ?? null,
    importAreas,
    unidentified,
    // Two fields that both say resume are two answers to the same question, and
    // attaching to the wrong one shows the page a document it did not ask for.
    ambiguous:
      resumeFields.length > 1
        ? resumeFields.map((field) => field.questionRef)
        : [],
  })
}

/** Case and accents are the page's typography, not part of what it asked. */
function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}
